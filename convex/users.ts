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
 * A "real" email is non-empty and NOT a synthetic placeholder.
 *
 * WorkOS webhook membership payloads do not carry profile fields, and a
 * membership role/status change can arrive without any email at all.
 * Persisting a synthetic `<userId>@unknown.workos` placeholder would
 * silently overwrite a real, verified email captured at login. Reconciliation
 * callers may therefore pass `email: undefined` to mean "preserve whatever
 * is already stored"; only an explicitly real email ever overwrites the row.
 */
function isRealEmail(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.toLowerCase().endsWith("@unknown.workos")
  );
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
 * Email preservation invariants (Phase 2):
 * - `email` is OPTIONAL. The WorkOS webhook membership payload does not
 *   carry profile fields; a role/status-only `updated` event arrives with
 *   no email. In that case the existing stored email (and name) MUST be
 *   preserved — never overwritten with `undefined` or a synthetic
 *   `<userId>@unknown.workos` placeholder. Only an explicitly real email
 *   overwrites the row.
 * - Creating a NEW user requires a real email; the caller resolves a
 *   verified WorkOS email before invoking this mutation. If none is
 *   available the caller fails closed (so WorkOS can retry) rather than
 *   persisting a synthetic address.
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
    // Optional: callers omit email for role/status-only webhook updates.
    // The mutation preserves any existing real email when this is absent.
    email: v.optional(v.string()),
    fullName: v.optional(v.string()),
    tenantId: v.id("tenants"),
    role: v.union(
      v.literal("owner"),
      v.literal("game_master"),
      v.literal("player")
    ),
    workosOrganizationMembershipId: v.optional(v.string()),
    // When present, applied directly to the membership. Used by the
    // WorkOS webhook path so that a `pending`/`inactive` membership in
    // WorkOS suspends the local row (and an `active` membership
    // re-activates it). When absent, the existing local status is
    // preserved — the user-initiated callback path does NOT override
    // explicit local suspensions.
    status: v.optional(
      v.union(v.literal("active"), v.literal("suspended"))
    ),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; membershipId: Id<"tenantMemberships"> }> => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant row missing during reconciliation");
    }

    const now = Date.now();
    // Only a real (non-synthetic, non-empty) email is ever written. When
    // the caller omits a usable email, the existing stored value is
    // preserved — this is what protects a real email from being
    // overwritten by a role/status-only webhook update.
    const usableEmail = isRealEmail(args.email) ? args.email.trim() : undefined;

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
      // Preserve the existing email/name unless the caller supplied a
      // real replacement. A role/status-only webhook update arrives with
      // no profile fields; writing `undefined` here would erase a real,
      // verified email captured at login.
      const patch: Record<string, unknown> = {
        workosUserId: args.workosUserId,
        tenantId: args.tenantId,
        lastSeenAt: now,
      };
      if (usableEmail) {
        patch.email = usableEmail;
        patch.emailNormalized = normalizeEmail(usableEmail);
      }
      if (args.fullName) {
        patch.fullName = args.fullName;
      }
      await ctx.db.patch(existingUser._id, patch);
      userId = existingUser._id;
    } else {
      // New user: a real email is required. The schema marks `email`
      // required, and we refuse to persist a synthetic placeholder. The
      // caller (webhook/login) resolves a verified WorkOS email first; if
      // it cannot, it must fail closed so the event/login can retry.
      if (!usableEmail) {
        throw new Error("EMAIL_REQUIRED: cannot create a user without a verified email");
      }
      userId = await ctx.db.insert("users", {
        tokenIdentifier: args.tokenIdentifier,
        workosUserId: args.workosUserId,
        email: usableEmail,
        emailNormalized: normalizeEmail(usableEmail),
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
      // When the WorkOS webhook passes `status`, it is authoritative —
      // pending / inactive memberships suspend locally, an active
      // status re-activates. When absent, preserve any explicit local
      // suspension (callback path) — the default re-activates a
      // previously-active row only.
      const nextStatus: "active" | "suspended" = args.status
        ? args.status
        : existingMembership.status === "suspended"
          ? "suspended"
          : "active";

      await ctx.db.patch(existingMembership._id, {
        role: args.role,
        workosOrganizationMembershipId:
          args.workosOrganizationMembershipId ?? existingMembership.workosOrganizationMembershipId,
        updatedAt: now,
        status: nextStatus,
      });
      membershipId = existingMembership._id;
    } else {
      membershipId = await ctx.db.insert("tenantMemberships", {
        tenantId: args.tenantId,
        userId,
        role: args.role,
        status: args.status ?? "active",
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
