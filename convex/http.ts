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
 * The canonical WorkOS organization id is resolved by the Convex caller
 * (the deployment runtime) and passed into the action. The browser never
 * controls it.
 *
 * Note: the AuthKit login callback no longer crosses this HTTP surface.
 * Login reconciliation runs through the public, token-authenticated
 * `api.callback.reconcileWorkosCallback` action, called from the Next.js
 * callback route via Convex's supported authenticated invocation. There is
 * no deploy-key-gated server-to-server bridge here anymore.
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
      } else if (message.startsWith("EMAIL_REQUIRED")) {
        // Created a membership without a resolvable verified email — let
        // WorkOS retry. No data was written.
        status = 409;
        publicError = "email required";
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

export default http;
