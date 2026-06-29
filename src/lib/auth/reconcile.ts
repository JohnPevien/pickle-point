/**
 * Phase 2.3 — callback reconciliation.
 *
 * Invoked by the WorkOS AuthKit callback route once the user has
 * completed browser-side authentication. Verifies the access token
 * JWT signature against WorkOS JWKS, extracts the authoritative
 * organization and role claims, then calls Convex to upsert the user
 * + membership projection through the server-to-server
 * `/internal/reconcile-callback` endpoint.
 *
 * Security invariants:
 *  - The JWT signature is verified with the WorkOS issuer + audience.
 *    A missing / expired / forged token fails closed and never
 *    touches the database.
 *  - The `sub` claim is asserted to equal the AuthKit session user
 *    id, so a JWT issued for one WorkOS user cannot be replayed
 *    against another.
 *  - The role and organization id come from JWT claims, never from
 *    browser-controlled session parameters.
 *  - Ordinary player login (no organization or role claim) is NEVER
 *    promoted to an administrative role.
 *  - Failure returns a deterministic safe support URL; no claims or
 *    tokens are written to logs or the response body.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { invokeInternalAction } from "@/lib/convex/internal";

export type WorkOSSessionUser = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

export type ReconcileInput = {
  user: WorkOSSessionUser;
  accessToken?: string;
};

export type ReconcileResult =
  | { ok: true }
  | { ok: false; redirectTo: "/support/access" };

type TokenClaims = {
  organizationId?: string;
  role?: string;
  subject: string;
};

/**
 * Lazy JWKS fetcher. `createRemoteJWKSet` caches keys for the
 * process lifetime and refreshes on `kid` misses. In dev / test the
 * verifier is replaced via `__setAccessTokenVerifier`.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (jwks) return jwks;
  const issuer = process.env.WORKOS_JWT_ISSUER ?? "https://api.workos.com";
  jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return jwks;
}

type AccessTokenVerifier = (
  accessToken: string,
  expectedSubject: string,
) => Promise<TokenClaims>;

const defaultVerifier: AccessTokenVerifier = async (accessToken, expectedSubject) => {
  const issuer = process.env.WORKOS_JWT_ISSUER ?? "https://api.workos.com";
  const audience = process.env.WORKOS_CLIENT_ID;
  if (!audience) {
    throw new Error("WORKOS_CLIENT_ID is not configured");
  }
  const { payload } = await jwtVerify(accessToken, getJwks(), {
    issuer,
    audience,
  });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("JWT missing sub claim");
  }
  if (payload.sub !== expectedSubject) {
    throw new Error("JWT sub does not match session user");
  }
  const orgId =
    (payload["organization_id"] as string | undefined) ??
    (payload["org_id"] as string | undefined);

  let role: string | undefined;
  const roles = payload["roles"];
  if (Array.isArray(roles) && roles.length > 0 && typeof roles[0] === "string") {
    role = roles[0];
  } else if (typeof roles === "string") {
    role = roles;
  } else if (typeof payload["role"] === "string") {
    role = payload["role"];
  }

  return {
    subject: payload.sub,
    organizationId: typeof orgId === "string" ? orgId : undefined,
    role,
  };
};

// Storage lives on globalThis so it survives `vi.resetModules()` in
// test setups; in production this is null and the default verifier runs.
const GLOBAL_KEY = Symbol.for("pickle-point.jwtVerifierOverride");
type GlobalWithVerifier = typeof globalThis & {
  [GLOBAL_KEY]?: AccessTokenVerifier | null;
};

export function __setAccessTokenVerifier(
  next: AccessTokenVerifier | null
): void {
  // Gating on a deliberate env flag rather than NODE_ENV means the
  // bypass is opt-in per process and is never silently enabled in a
  // production deployment that happens to run tests.
  if (process.env.ALLOW_AUTH_TEST_BYPASS !== "1") {
    throw new Error(
      "Refusing to override JWT verifier outside test environments; set ALLOW_AUTH_TEST_BYPASS=1 to opt in.",
    );
  }
  (globalThis as GlobalWithVerifier)[GLOBAL_KEY] = next;
}

function getVerifierOverride(): AccessTokenVerifier | null {
  return (globalThis as GlobalWithVerifier)[GLOBAL_KEY] ?? null;
}

/**
 * Map a WorkOS role slug to a tenant role. Single source of truth:
 * the webhook path uses the same mapping. `owner`/`admin` → owner,
 * `game_master`/`gm` → game_master, anything else → player.
 */
function mapRole(raw: string | undefined): "owner" | "game_master" | "player" {
  if (!raw) return "player";
  const normalized = raw.toLowerCase();
  if (normalized === "owner" || normalized === "admin") return "owner";
  if (normalized === "game_master" || normalized === "gm") return "game_master";
  return "player";
}

export async function reconcileWorkosCallback(
  input: ReconcileInput
): Promise<ReconcileResult> {
  const { user } = input;

  if (!user || !user.id) {
    return { ok: false, redirectTo: "/support/access" };
  }
  if (!input.accessToken) {
    return { ok: false, redirectTo: "/support/access" };
  }

  const verifier = getVerifierOverride() ?? defaultVerifier;
  let claims: TokenClaims;
  try {
    claims = await verifier(input.accessToken, user.id);
  } catch {
    return { ok: false, redirectTo: "/support/access" };
  }

  const canonicalOrgId = process.env.WORKOS_ORGANIZATION_ID || null;
  const tenantSlug = process.env.PICKLE_POINT_TENANT_SLUG || null;
  const organizationId = claims.organizationId;
  const inCanonicalOrg =
    organizationId !== undefined &&
    canonicalOrgId !== null &&
    organizationId === canonicalOrgId;

  // Refuse claims that target a different organization than the
  // canonical one. When canonical is unset (dev), we still require
  // the JWT to claim some organization id so personal-account
  // sessions cannot become administrative.
  if (organizationId && canonicalOrgId && !inCanonicalOrg) {
    return { ok: false, redirectTo: "/support/access" };
  }
  if (!organizationId) {
    // Personal-account session: player only.
    return invokeReconcile({
      workosUserId: claims.subject,
      email: user.email,
      fullName:
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || undefined,
      organizationId: undefined,
      role: "player",
      tenantSlug: tenantSlug ?? undefined,
    });
  }

  return invokeReconcile({
    workosUserId: claims.subject,
    email: user.email,
    fullName:
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || undefined,
    organizationId: inCanonicalOrg ? organizationId : undefined,
    role: mapRole(claims.role),
    tenantSlug: tenantSlug ?? undefined,
  });
}

async function invokeReconcile(args: {
  workosUserId: string;
  email: string | undefined;
  fullName: string | undefined;
  organizationId: string | undefined;
  role: "owner" | "game_master" | "player";
  tenantSlug: string | undefined;
}): Promise<ReconcileResult> {
  if (!args.email) {
    // Without an email we cannot create a stable user projection; the
    // next login will retry once AuthKit surfaces a verified email.
    return { ok: false, redirectTo: "/support/access" };
  }
  try {
    await invokeInternalAction("/internal/reconcile-callback", args);
    return { ok: true };
  } catch {
    return { ok: false, redirectTo: "/support/access" };
  }
}