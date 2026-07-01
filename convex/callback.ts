/**
 * Phase 2.3 — callback reconciliation entrypoint.
 *
 * A **public, token-authenticated** action invoked by the WorkOS AuthKit
 * callback route after a successful sign-in. The caller (Next.js route)
 * passes the WorkOS access token through Convex's supported authenticated
 * invocation (`fetchAction(..., { token })`); Convex validates the JWT
 * signature/issuer/audience via `convex/auth.config.ts` and surfaces the
 * identity through `ctx.auth.getUserIdentity()`.
 *
 * Security invariants:
 *  - The action takes **no arguments**. WorkOS user id, organization id,
 *    and role are derived from the authenticated identity; profile fields
 *    are resolved server-side from WorkOS using that verified subject.
 *    None are accepted from the caller. This removes the old deploy-key
 *    HTTP bridge and manual JWT verification.
 *  - The tenant is resolved server-side from the canonical WorkOS
 *    organization id (or the canonical slug in dev), never from a
 *    browser-supplied tenant id or slug.
 *  - Ordinary player login (no canonical organization claim) is **never**
 *    promoted to an administrative role.
 *  - Database writes stay inside the internal `reconcileUserAndMembership`
 *    mutation, which is idempotent by `tokenIdentifier` and by
 *    `(tenantId, userId)` so replay and double-callback are safe.
 *  - The action returns a coarse status only. It never echoes tokens,
 *    claims, organization ids, emails, or internal error messages.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";

export type ReconcileStatus =
  | "ok"
  // No authenticated identity attached to the call. The callback route
  // treats any non-`ok` status as a failure and routes to support.
  | "unauthenticated"
  // Neither the authenticated claims nor the server-side WorkOS profile
  // supplied a usable email. Fail safely so a later login can retry.
  | "email_required"
  // The identity's organization claim targets a different organization
  // than the canonical one configured for this deployment.
  | "forbidden"
  // No fixed tenant is provisioned for the resolved organization or slug.
  | "tenant_not_provisioned";

type TenantRole = "owner" | "game_master" | "player";

/**
 * Read the WorkOS role claims attached to the identity. WorkOS tokens may
 * carry `roles` (array of slugs) or a single `role` string. The values are
 * never trusted as arguments — they come from the verified JWT.
 */
function readRoleClaim(identity: { [k: string]: unknown }): string[] {
  const raw = identity["roles"];
  if (Array.isArray(raw)) return raw.map(String);
  const single = identity["role"];
  if (typeof single === "string") return [single];
  return [];
}

/**
 * Map WorkOS role slugs to a tenant role. Single source of truth shared
 * with the webhook path's intent: `owner`/`admin` → owner,
 * `game_master`/`gm` → game_master, anything else → player.
 */
function mapRole(slugs: string[]): TenantRole {
  for (const slug of slugs) {
    const s = slug.toLowerCase();
    if (s === "owner" || s === "admin") return "owner";
  }
  for (const slug of slugs) {
    const s = slug.toLowerCase();
    if (s === "game_master" || s === "gm") return "game_master";
  }
  return "player";
}

export const reconcileWorkosCallback = action({
  args: {},
  handler: async (ctx): Promise<{ status: ReconcileStatus }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { status: "unauthenticated" };
    }

    // Derive identity fields exclusively from the authenticated identity.
    // `subject` is the WorkOS user id; `tokenIdentifier` is the canonical
    // stable key Convex uses for identity linkage.
    const workosUserId = identity.subject;
    const identityEmail = identity.email;
    const emailVerified = identity.emailVerified;
    let fullName =
      [identity.givenName, identity.familyName]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" ")
        .trim() ||
      (typeof identity.name === "string" && identity.name.length > 0
        ? identity.name
        : undefined);

    // Require a usable email before persisting. Without one we cannot
    // create a stable user projection. An explicitly unverified email
    // (`emailVerified === false`) is rejected; an absent claim does not
    // block, since not every WorkOS token carries `email_verified`.
    if (
      typeof identityEmail === "string" &&
      identityEmail.length > 0 &&
      emailVerified === false
    ) {
      return { status: "email_required" };
    }

    let email =
      typeof identityEmail === "string" &&
      identityEmail.length > 0 &&
      emailVerified !== false
        ? identityEmail
        : undefined;

    // Standard AuthKit access tokens carry identity and organization
    // claims, but not profile fields such as email/name. Resolve those
    // server-side from the verified WorkOS subject rather than accepting
    // them as callback arguments from the browser.
    if (!email) {
      const profile: { email: string | null; fullName: string | null } =
        await ctx.runAction(internal.workosActions.resolveUserProfile, {
          workosUserId,
        });
      email = profile.email ?? undefined;
      fullName = profile.fullName ?? fullName;
    }

    if (!email) {
      return { status: "email_required" };
    }

    // Derive organization + role from trusted JWT claims only.
    const organizationId =
      (identity["organization_id"] as string | undefined) ??
      (identity["org_id"] as string | undefined);

    const canonicalOrgId = process.env.WORKOS_ORGANIZATION_ID || null;
    const inCanonicalOrg =
      organizationId !== undefined &&
      canonicalOrgId !== null &&
      organizationId === canonicalOrgId;

    // A present-but-mismatched organization claim is denied. Personal-
    // account sessions (no org claim) are allowed but never elevated.
    if (organizationId && canonicalOrgId && !inCanonicalOrg) {
      return { status: "forbidden" };
    }

    // Resolve the tenant server-side. Canonical-org sessions resolve by
    // WorkOS organization id; personal-account / dev sessions resolve the
    // single fixed tenant by canonical slug.
    let tenantId;
    if (organizationId && inCanonicalOrg) {
      const byOrg = await ctx.runQuery(internal.tenants.findByOrgId, {
        workosOrganizationId: organizationId,
      });
      if (!byOrg) {
        return { status: "tenant_not_provisioned" };
      }
      tenantId = byOrg._id;
    } else {
      const tenantSlug = process.env.PICKLE_POINT_TENANT_SLUG || null;
      if (!tenantSlug) {
        return { status: "tenant_not_provisioned" };
      }
      const bySlug = await ctx.runQuery(internal.tenants.findBySlug, {
        slug: tenantSlug,
      });
      if (!bySlug) {
        return { status: "tenant_not_provisioned" };
      }
      tenantId = bySlug._id;
    }

    // Only a canonical-org session may carry an administrative role; every
    // other session reconciles as a player.
    const role: TenantRole =
      organizationId && inCanonicalOrg ? mapRole(readRoleClaim(identity)) : "player";

    await ctx.runMutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: identity.tokenIdentifier,
      workosUserId,
      email,
      fullName,
      tenantId,
      role,
    });

    return { status: "ok" };
  },
});
