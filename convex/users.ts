import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Resolves the authenticated Convex user record by token identifier.
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .first();
  },
});

/**
 * Normalize an email for case-insensitive lookup. Phase 1 invariant:
 * identity linkage NEVER happens via email. We normalize so the
 * `by_emailNormalized` index supports canonical lookups for migration
 * diagnostics only — never for authorization.
 */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Creates or refreshes a user record for an authenticated identity inside a tenant workspace.
 *
 * Phase 1 widening: `workosUserId`, `emailNormalized`, and `lastSeenAt`
 * are now required on the `users` table. The legacy `tenantId` field is
 * preserved as a transitional column during migration; authorization
 * code in `convex/lib/authz.ts` reads `tenantMemberships`, not this field.
 */
export const getOrCreateUser = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    workosUserId: v.string(),
    email: v.string(),
    emailNormalized: v.string(),
    fullName: v.optional(v.string()),
    tenantId: v.id("tenants"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier)
      )
      .first();

    const now = Date.now();
    const emailNormalized = normalizeEmail(args.emailNormalized);

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        emailNormalized,
        workosUserId: args.workosUserId,
        fullName: args.fullName ?? existing.fullName,
        lastSeenAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: args.tokenIdentifier,
      workosUserId: args.workosUserId,
      email: args.email,
      emailNormalized,
      fullName: args.fullName,
      tenantId: args.tenantId,
      createdAt: now,
      lastSeenAt: now,
    });
  },
});

/**
 * Task 1.3: idempotent WorkOS reconciliation.
 *
 * Caller invariants:
 * - `tokenIdentifier` is the canonical Convex identity key.
 * - `tenantId` was resolved server-side (Phase 2 callback passes the
 *   WorkOS-validated tenant, never a browser-supplied value).
 * - `role` comes from the trusted WorkOS organization/role claim, not
 *   from any UI input.
 *
 * Behavior:
 * - User upsert by `tokenIdentifier`. Email is normalized for
 *   diagnostic lookup but is NEVER used for identity resolution.
 * - Membership upsert by (`tenantId`, `userId`). The membership
 *   projection's role and WorkOS linkage are overwritten with the
 *   trusted WorkOS claim; an explicit local suspension is preserved
 *   until an owner/admin reversal happens.
 * - Audit row recorded with action `user.reconcile`.
 */
export const reconcileUserAndMembership = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    workosUserId: v.string(),
    email: v.string(),
    fullName: v.optional(v.string()),
    tenantId: v.id("tenants"),
    role: v.union(
      v.literal("owner"),
      v.literal("game_master"),
      v.literal("player")
    ),
    workosOrganizationMembershipId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; membershipId: Id<"tenantMemberships"> }> => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant row missing during reconciliation");
    }

    const now = Date.now();
    const emailNormalized = normalizeEmail(args.email);

    // Upsert user by tokenIdentifier. Email linkage is NEVER used as
    // the identity key — a different tokenIdentifier always means a
    // distinct user row even when email collides.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier)
      )
      .first();

    // Conflict guard #1: if this tokenIdentifier is already bound to a
    // DIFFERENT workosUserId, refuse to silently rewrite it. The
    // caller (WorkOS callback in Phase 2) must never rebind a token to
    // a new WorkOS account; that signals token reuse or a migration
    // bug, and overwriting would silently hijack the original user's
    // membership and audit trail.
    if (existingUser && existingUser.workosUserId && existingUser.workosUserId !== args.workosUserId) {
      throw new Error("IDENTITY_CONFLICT: tokenIdentifier bound to a different workosUserId");
    }

    // Conflict guard #2: if a DIFFERENT user (different tokenIdentifier)
    // already owns the incoming workosUserId, refuse to create a second
    // row. A single WorkOS account must map to exactly one Convex user
    // identity; allowing two users to share a workosUserId would let
    // either claim the other's membership via future reconciliation.
    const existingByWorkosId = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", args.workosUserId))
      .first();
    if (
      existingByWorkosId &&
      existingByWorkosId.tokenIdentifier !== args.tokenIdentifier
    ) {
      throw new Error("IDENTITY_CONFLICT: workosUserId already bound to a different tokenIdentifier");
    }

    let userId: Id<"users">;
    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        email: args.email,
        emailNormalized,
        workosUserId: args.workosUserId,
        fullName: args.fullName ?? existingUser.fullName,
        tenantId: args.tenantId,
        lastSeenAt: now,
      });
      userId = existingUser._id;
    } else {
      userId = await ctx.db.insert("users", {
        tokenIdentifier: args.tokenIdentifier,
        workosUserId: args.workosUserId,
        email: args.email,
        emailNormalized,
        fullName: args.fullName,
        tenantId: args.tenantId,
        createdAt: now,
        lastSeenAt: now,
      });
    }

    // Upsert membership by (tenantId, userId). There is exactly one
    // membership per (tenant, user) pair — Phase 1 enforces this
    // compound uniqueness through `by_tenantId_and_userId` and the
    // no-merge-by-email invariant.
    const existingMembership = await ctx.db
      .query("tenantMemberships")
      .withIndex("by_tenantId_and_userId", (q) =>
        q.eq("tenantId", args.tenantId).eq("userId", userId)
      )
      .first();

    let membershipId: Id<"tenantMemberships">;
    if (existingMembership) {
      await ctx.db.patch(existingMembership._id, {
        role: args.role,
        workosOrganizationMembershipId:
          args.workosOrganizationMembershipId ?? existingMembership.workosOrganizationMembershipId,
        updatedAt: now,
        // A previously suspended membership is reactivated when WorkOS
        // re-grants the role; explicit local suspensions by an owner
        // are preserved by not changing status on patch unless it was
        // already active. Phase 3 introduces a dedicated suspension API.
        status: existingMembership.status === "suspended" ? "suspended" : "active",
      });
      membershipId = existingMembership._id;
    } else {
      membershipId = await ctx.db.insert("tenantMemberships", {
        tenantId: args.tenantId,
        userId,
        role: args.role,
        status: "active",
        workosOrganizationMembershipId: args.workosOrganizationMembershipId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("auditLogs", {
      tenantId: args.tenantId,
      actorUserId: userId,
      action: "user.reconcile",
      resourceType: "tenantMemberships",
      resourceId: membershipId,
      after: JSON.stringify({
        tokenIdentifier: args.tokenIdentifier,
        role: args.role,
        workosOrganizationMembershipId: args.workosOrganizationMembershipId ?? null,
      }),
      createdAt: now,
    });

    return { userId, membershipId };
  },
});
