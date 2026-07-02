import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";

/**
 * Phase 1.2: central authorization helpers.
 *
 * Invariants:
 * - Identity is resolved server-side via `ctx.auth.getUserIdentity()`,
 *   keyed on `identity.tokenIdentifier`. Browser-supplied IDs never
 *   grant authority.
 * - Stable error codes match the design spec:
 *   UNAUTHENTICATED, FORBIDDEN, MEMBERSHIP_SUSPENDED, PROFILE_REQUIRED,
 *   RESOURCE_NOT_FOUND, TENANT_MISMATCH.
 * - For any admin role (owner / game_master), `requireRole` and
 *   `requireOwnPlayer` automatically validate the trusted WorkOS
 *   organization / role claims attached to the current JWT. The
 *   validation looks at the actual JWT issuer/claims, not just the
 *   local membership id, so a stale local projection cannot grant
 *   authority after WorkOS revokes the role. There is no caller-
 *   controllable opt-out — every admin surface is protected
 *   unconditionally.
 * - Standard WorkOS AuthKit access tokens do not carry an
 *   `organization_membership_id` claim. The local
 *   `tenantMemberships.workosOrganizationMembershipId` projection,
 *   maintained by reconciliation/webhooks, is the source of truth for
 *   membership linkage and must still be present on the local row.
 */

type Ctx = QueryCtx | MutationCtx;

/** Stable application errors — codes match the design spec. */
export class AppError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "AppError";
  }
}

/**
 * Resolve the Convex user row for the calling identity. Throws
 * UNAUTHENTICATED when no identity is attached or when the user
 * record has not yet been projected by reconciliation (Task 1.3).
 */
export async function requireAuthenticatedUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new AppError("UNAUTHENTICATED");
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier)
    )
    .first();
  if (!user) {
    throw new AppError("UNAUTHENTICATED");
  }
  return user;
}

/**
 * Resolve the user's active membership row in a tenant.
 *
 * - Throws UNAUTHENTICATED when no identity is present.
 * - Throws FORBIDDEN when the identity is known but has no membership.
 * - Throws MEMBERSHIP_SUSPENDED when the membership row is suspended.
 * - Throws RESOURCE_NOT_FOUND when the tenant row is missing.
 */
export async function requireTenantMembership(
  ctx: Ctx,
  tenantId: Id<"tenants">
): Promise<Doc<"tenantMemberships">> {
  const user = await requireAuthenticatedUser(ctx);
  const tenant = await ctx.db.get(tenantId);
  if (!tenant) {
    throw new AppError("RESOURCE_NOT_FOUND");
  }
  const membership = await ctx.db
    .query("tenantMemberships")
    .withIndex("by_tenantId_and_userId", (q) =>
      q.eq("tenantId", tenantId).eq("userId", user._id)
    )
    .first();
  if (!membership) {
    throw new AppError("FORBIDDEN");
  }
  if (membership.status !== "active") {
    throw new AppError("MEMBERSHIP_SUSPENDED");
  }
  return membership;
}

export type TenantRole = "owner" | "game_master" | "player";

function isAdminRole(role: TenantRole): boolean {
  return role === "owner" || role === "game_master";
}

/**
 * Validate that the caller's membership role is in `allowedRoles`.
 *
 * Whenever the resolved membership role is `owner` or `game_master`
 * (i.e. an admin role), the helper additionally validates the trusted
 * WorkOS organization/role claims attached to the current JWT. The
 * validation:
 *
 *   1. Confirms the JWT issuer is the WorkOS issuer URL.
 *   2. Confirms the membership carries a recorded WorkOS linkage
 *      (the local `workosOrganizationMembershipId` projection
 *      maintained by reconciliation/webhooks).
 *   3. Confirms the tenant's workosOrganizationId matches the
 *      `organization_id` / `org_id` claim.
 *   4. Confirms the JWT's `role` / `roles` claim names the
 *      caller's local membership role.
 *
 * Standard WorkOS AuthKit access tokens do not carry an
 * `organization_membership_id` claim; the local projection is the
 * source of truth for membership linkage and is required on the row.
 * Any mismatch fails closed with FORBIDDEN. There is no caller-
 * controllable opt-out — every admin surface is protected
 * unconditionally.
 */
export async function requireRole(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  allowedRoles: ReadonlyArray<TenantRole>
): Promise<{ user: Doc<"users">; membership: Doc<"tenantMemberships"> }> {
  const membership = await requireTenantMembership(ctx, tenantId);
  if (!allowedRoles.includes(membership.role)) {
    throw new AppError("FORBIDDEN");
  }
  if (isAdminRole(membership.role)) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new AppError("UNAUTHENTICATED");
    }
    const tenant = await ctx.db.get(tenantId);
    if (!tenant) {
      throw new AppError("RESOURCE_NOT_FOUND");
    }
    validateWorkOSClaim(identity, tenant, membership);
  }
  const user = await requireAuthenticatedUser(ctx);
  return { user, membership };
}

export async function requireOwner(
  ctx: Ctx,
  tenantId: Id<"tenants">
): Promise<{ user: Doc<"users">; membership: Doc<"tenantMemberships"> }> {
  return requireRole(ctx, tenantId, ["owner"]);
}

/**
 * Returns the caller's linked account-backed player profile in a tenant.
 * Resolves the authenticated user's active membership with
 * `requireTenantMembership`, then reads the `players` compound index
 * `by_tenantId_and_userId` with `.unique()` for the exact
 * (tenantId, userId) pair. Only a `profileKind === "account"` profile is
 * returned; a missing row or a legacy/unlinked profile fails closed with
 * PROFILE_REQUIRED. Legacy rows are never matched through contact or
 * display fields.
 */
export async function requirePlayerProfile(
  ctx: Ctx,
  tenantId: Id<"tenants">
): Promise<Doc<"players">> {
  const membership = await requireTenantMembership(ctx, tenantId);
  const profile = await ctx.db
    .query("players")
    .withIndex("by_tenantId_and_userId", (q) =>
      q.eq("tenantId", tenantId).eq("userId", membership.userId)
    )
    .unique();
  if (!profile || profile.profileKind !== "account") {
    throw new AppError("PROFILE_REQUIRED");
  }
  return profile;
}

/**
 * Verify the caller may act on a player row in the tenant derived
 * from the player id. An account profile linked to the authenticated
 * user is owned by that user directly. Any other row is only reachable
 * through the admin path (owner / game_master), which `requireRole`
 * validates against the trusted WorkOS organization/role claims so a
 * stale local projection cannot grant authority after WorkOS revokes
 * the role. Unrelated players and non-members fail closed with FORBIDDEN.
 * A missing player throws RESOURCE_NOT_FOUND rather than returning null,
 * so no caller can distinguish "exists but forbidden" from "absent".
 */
export async function requireOwnPlayer(
  ctx: Ctx,
  playerId: Id<"players">
): Promise<{ player: Doc<"players">; user: Doc<"users">; membership: Doc<"tenantMemberships"> }> {
  const player = await ctx.db.get(playerId);
  if (!player) {
    throw new AppError("RESOURCE_NOT_FOUND");
  }

  // Resolve the caller's authenticated user + active membership in the
  // player's tenant. A non-member fails closed here (FORBIDDEN /
  // MEMBERSHIP_SUSPENDED) before the ownership / admin path is tried.
  const membership = await requireTenantMembership(ctx, player.tenantId);

  // Ownership: the player is an account profile linked to this user.
  if (
    player.profileKind === "account" &&
    player.userId !== undefined &&
    player.userId === membership.userId
  ) {
    const user = await requireAuthenticatedUser(ctx);
    return { player, user, membership };
  }

  // Otherwise the caller needs an admin role, validated through
  // `requireRole` so the trusted WorkOS claims are still checked.
  const admin = await requireRole(ctx, player.tenantId, ["owner", "game_master"]);
  return { player, ...admin };
}

/**
 * Stub for session-participant ownership checks; the table lands in
 * Task 5.2. Fails closed today so callers that accidentally rely on
 * it surface the missing schema.
 */
export async function requireOwnParticipation(
  ctx: Ctx,
  participationId: string
): Promise<never> {
  // Phase 1 placeholder: the `sessionParticipants` table lands in
  // Task 5.2. Until then this throws so callers that accidentally
  // reach it fail closed.
  void ctx;
  void participationId;
  throw new AppError("RESOURCE_NOT_FOUND");
}

/* ---------------------------------------------------------------------- */
/* Internal helpers                                                        */
/* ---------------------------------------------------------------------- */

/**
 * Validate the trusted WorkOS organization/role claims attached to
 * the current JWT against the local tenant + membership projection.
 *
 * Phase 1 WorkOS AuthKit claim shape (from `convex/auth.config.ts`):
 * - `identity.issuer` is the WorkOS issuer URL.
 * - `identity.subject` is the WorkOS user id.
 * - Custom claims: `organization_id` / `org_id` and `role` / `roles`.
 *
 * Standard AuthKit access tokens do NOT carry an
 * `organization_membership_id` claim; the local
 * `tenantMemberships.workosOrganizationMembershipId` projection
 * (maintained by reconciliation/webhooks) is the source of truth for
 * membership linkage and is required on the local row.
 */
function validateWorkOSClaim(
  identity: { issuer?: string; subject?: string; [k: string]: unknown },
  tenant: Doc<"tenants">,
  membership: Doc<"tenantMemberships">
): void {
  // 1. Issuer must be WorkOS. We refuse any other issuer rather than
  //    trusting a developer-supplied alternative configuration.
  if (!identity.issuer || !identity.issuer.startsWith("https://api.workos.com")) {
    throw new AppError("FORBIDDEN");
  }

  // 2. The membership must carry a WorkOS linkage recorded by the
  //    webhook reconciler. Without it we cannot trust the local
  //    role against the trusted claim.
  if (!membership.workosOrganizationMembershipId) {
    throw new AppError("FORBIDDEN");
  }

  // 3. WorkOS AuthKit access tokens for org-authenticated sessions
  //    always carry an `organization_id` (or legacy `org_id`) custom
  //    claim. Absence means the JWT is a personal-account session
  //    without an organization context — admin helpers must reject
  //    rather than silently skip the check.
  const claimOrgId =
    (identity["organization_id"] as string | undefined) ??
    (identity["org_id"] as string | undefined);
  if (!claimOrgId) {
    throw new AppError("FORBIDDEN");
  }
  if (tenant.workosOrganizationId && claimOrgId !== tenant.workosOrganizationId) {
    throw new AppError("FORBIDDEN");
  }

  // 4. The JWT must name the caller's local membership role (WorkOS
  //    custom claims may carry `roles` (array) or a single `role`
  //    string). WorkOS AuthKit tokens do not carry a
  //    `organization_membership_id` claim; we do not require it.
  const claimRoles = readRolesFromIdentity(identity);
  if (claimRoles.length === 0) {
    throw new AppError("FORBIDDEN");
  }
  // Map the local membership role back to the WorkOS slugs that
  // authorise it. `owner` is granted by `owner` or `admin`; the
  // callback path maps `admin` to `owner` for storage so the inverse
  // is needed here. `game_master` is granted by its own slug or `gm`.
  const authorizedSlugs = expandRole(membership.role);
  if (!claimRoles.some((role) => authorizedSlugs.includes(role.toLowerCase()))) {
    throw new AppError("FORBIDDEN");
  }
}

function expandRole(role: TenantRole): string[] {
  if (role === "owner") return ["owner", "admin"];
  if (role === "game_master") return ["game_master", "gm"];
  return [role];
}

function readRolesFromIdentity(identity: { [k: string]: unknown }): string[] {
  const raw = identity["roles"];
  if (Array.isArray(raw)) return raw.map(String);
  const single = identity["role"];
  if (typeof single === "string") return [single];
  return [];
}