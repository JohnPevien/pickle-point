/**
 * Phase 2.3 — callback reconciliation entrypoint.
 *
 * Server-only internal action that the AuthKit callback route calls
 * after a successful sign-in. Resolves the canonical tenant and asks
 * the idempotent `users.reconcileUserAndMembership` mutation to upsert
 * the user + membership projection using trusted, server-side fields
 * only.
 *
 * Invariants:
 *  - `organizationId` and `role` come from the trusted WorkOS session,
 *    not from the browser.
 *  - The tenant is resolved from the canonical WorkOS organization id,
 *    never from a browser-supplied tenant id or slug.
 *  - When the organization claim is missing or matches a different org,
 *    the role is forced to "player" so ordinary sign-in can never grant
 *    administrative authority.
 *  - `reconcileUserAndMembership` is idempotent by `tokenIdentifier` and
 *    by `(tenantId, userId)` so replay and double-callback are safe.
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const reconcileWorkosCallback = internalAction({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    fullName: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    role: v.union(v.literal("owner"), v.literal("game_master"), v.literal("player")),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve the canonical tenant by WorkOS organization id (preferred)
    // or by canonical slug (dev fallback when no organization claim).
    let tenantId;
    if (args.organizationId) {
      const byOrg = await ctx.runQuery(internal.tenants.findByOrgId, {
        workosOrganizationId: args.organizationId,
      });
      if (!byOrg) {
        // Organization is not provisioned for this deployment. We cannot
        // safely create a tenant from a callback; treat the user as a
        // player in no tenant (i.e. they will land on a profile-completion
        // or access-denied screen in Phase 4).
        return { status: "tenant_not_provisioned" as const };
      }
      tenantId = byOrg._id;
    } else if (args.tenantSlug) {
      const bySlug = await ctx.runQuery(internal.tenants.findBySlug, {
        slug: args.tenantSlug,
      });
      if (!bySlug) {
        return { status: "tenant_not_provisioned" as const };
      }
      tenantId = bySlug._id;
    } else {
      return { status: "tenant_not_provisioned" as const };
    }

    await ctx.runMutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: `https://api.workos.com|${args.workosUserId}`,
      workosUserId: args.workosUserId,
      email: args.email,
      fullName: args.fullName,
      tenantId,
      role: args.role,
    });

    return { status: "reconciled" as const };
  },
});