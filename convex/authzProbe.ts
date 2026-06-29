import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  requireAuthenticatedUser,
  requireTenantMembership,
  requireRole,
  requireOwner,
  requireOwnPlayer,
  requirePlayerProfile,
} from "./lib/authz";

/**
 * Thin query wrappers that exercise the authz helpers. They exist
 * because `convex-test` invokes functions by their public name; the
 * helper library is a pure utility that operates on a context.
 *
 * These probes are not user-facing — they live only to drive
 * `convex/lib/authz.test.ts`. They will be deleted once the
 * authorization work is hardened into the real public surface in
 * Phase 3.
 */
export const requireAuthenticatedUserProbe = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    // touch args so unused-arg linting is satisfied
    void args;
    return { id: user._id, email: user.email };
  },
});

export const requireTenantMembershipProbe = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const membership = await requireTenantMembership(ctx, args.tenantId);
    return { role: membership.role, status: membership.status };
  },
});

export const requireRoleProbe = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    allowedRoles: v.array(
      v.union(v.literal("owner"), v.literal("game_master"), v.literal("player"))
    ),
    requireTrustedWorkOSClaim: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireRole(ctx, args.tenantId, args.allowedRoles, {
      requireTrustedWorkOSClaim: args.requireTrustedWorkOSClaim,
    });
    return { role: membership.role };
  },
});

export const requireOwnerProbe = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership } = await requireOwner(ctx, args.tenantId);
    return { role: membership.role };
  },
});

export const requirePlayerProfileProbe = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const profile = await requirePlayerProfile(ctx, args.tenantId);
    return { id: profile._id };
  },
});

export const requireOwnPlayerProbe = internalQuery({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => {
    const { player } = await requireOwnPlayer(ctx, args.playerId as Id<"players">);
    return { tenantId: player.tenantId };
  },
});