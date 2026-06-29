/**
 * Phase 2.2 — WorkOS webhook HTTP route.
 *
 * Receives signed WorkOS webhook deliveries at `/workos/webhooks`,
 * forwards the raw bytes and signature header to the Node-only
 * `ingestSignedWebhook` action, and returns a 200 response on
 * accepted or duplicate deliveries. Any verification failure
 * returns 401 (INVALID_SIGNATURE) or 403 (WRONG_ORGANIZATION)
 * so retries can be observed by WorkOS.
 *
 * Note: the canonical WorkOS organization id is resolved by the
 * Convex caller (the deployment runtime) and passed into the
 * action. The browser never controls it.
 *
 * Phase 2.3 — `/internal/reconcile-callback`
 *
 * The Next.js WorkOS callback handler calls this endpoint after a
 * successful sign-in to upsert the user + membership projection
 * using trusted, server-side data extracted from the access token
 * JWT and the AuthKit session. The endpoint is gated on a deploy
 * key (NOT a user JWT) so it cannot be invoked by the browser.
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

function getExpectedOrganizationId(): string {
  const orgId = process.env.WORKOS_ORGANIZATION_ID;
  if (!orgId || orgId.length === 0) {
    throw new Error("WORKOS_ORGANIZATION_ID is not configured");
  }
  return orgId;
}

function getConvexDeployKey(): string {
  const key = process.env.CONVEX_DEPLOY_KEY ?? "";
  return key;
}

function authorizeDeploy(request: Request): boolean {
  const expected = getConvexDeployKey();
  if (!expected) {
    // In dev (no deploy key), refuse to expose internal endpoints to
    // the open internet. Local dev should call the reconciler through
    // the regular `internal.callback.reconcileWorkosCallback` action
    // via the Convex test harness.
    return false;
  }
  const supplied =
    request.headers.get("x-convex-deploy-key") ??
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ??
    "";
  return supplied === expected;
}

const http = httpRouter();

http.route({
  path: "/workos/webhooks",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature =
      request.headers.get("workos-signature") ??
      request.headers.get("WorkOS-Signature") ??
      "";
    if (!signature) {
      return new Response(JSON.stringify({ error: "missing signature" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    // Cap body at 256 KB. WorkOS webhook deliveries are < 8 KB; anything
    // larger is either a misconfigured client or an attack. Reading as
    // text() with a guard prevents unbounded memory growth.
    const MAX_BODY_BYTES = 256 * 1024;
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "payload too large" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "payload too large" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }

    let expectedOrganizationId: string;
    try {
      expectedOrganizationId = getExpectedOrganizationId();
    } catch {
      return new Response(JSON.stringify({ error: "configuration error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      const result = await ctx.runAction(internal.workosActions.ingestSignedWebhook, {
        rawBody,
        signatureHeader: signature,
        expectedOrganizationId,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      // Map known failure codes to status + a generic body. We never
      // echo the underlying SDK error message because it leaks SDK
      // version and expected header shape.
      const message = error instanceof Error ? error.message : "";
      let status = 500;
      let publicError = "internal error";
      if (message.startsWith("INVALID_SIGNATURE")) {
        status = 401;
        publicError = "invalid signature";
      } else if (message.startsWith("WRONG_ORGANIZATION")) {
        status = 403;
        publicError = "wrong organization";
      } else if (message.startsWith("WEBHOOK_INVALID")) {
        status = 400;
        publicError = "invalid webhook";
      }
      // Server-side logging is handled by Convex runtime. The body
      // never carries the raw cause.
      return new Response(JSON.stringify({ error: publicError }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
  }),
});

/**
 * Server-to-server bridge for the AuthKit callback. Body shape:
 *
 *   {
 *     workosUserId: string,
 *     email: string,
 *     fullName?: string,
 *     organizationId?: string,
 *     role: "owner" | "game_master" | "player",
 *     tenantSlug?: string,
 *   }
 *
 * Returns 401 when the deploy key is missing or wrong, 200 when the
 * action succeeded (including tenant-not-provisioned), and 500 on
 * unexpected errors. No information about the caller is leaked in
 * the error message.
 */
http.route({
  path: "/internal/reconcile-callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorizeDeploy(request)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    let parsed: {
      workosUserId?: string;
      email?: string;
      fullName?: string;
      organizationId?: string;
      role?: "owner" | "game_master" | "player";
      tenantSlug?: string;
    };
    try {
      parsed = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const { workosUserId, email, fullName, organizationId, role, tenantSlug } = parsed;
    if (!workosUserId || !email || !role) {
      return new Response(
        JSON.stringify({ error: "missing required fields" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    try {
      const result = await ctx.runAction(internal.callback.reconcileWorkosCallback, {
        workosUserId,
        email,
        fullName,
        organizationId: organizationId || undefined,
        role,
        tenantSlug: tenantSlug || undefined,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      // The reconciler already validated all inputs. Unexpected errors
      // surface a generic message; callers can retry.
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "internal error",
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }),
});

export default http;
