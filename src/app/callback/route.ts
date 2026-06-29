/**
 * WorkOS AuthKit callback route.
 *
 * - `handleAuth()` performs the full OAuth/PKCE dance, verifies state,
 *   exchanges the authorization code, sets the AuthKit session cookie,
 *   and redirects to the requested return path. We do NOT customise
 *   the PKCE cookie handling.
 * - `onSuccess` runs only after a successful authentication. It calls
 *   the public, token-authenticated Convex action
 *   `api.callback.reconcileWorkosCallback`, forwarding the access token
 *   through Convex's supported authenticated invocation. Convex validates
 *   the JWT (issuer/audience via `convex/auth.config.ts`) and derives
 *   the WorkOS user, organization, and role exclusively from the
 *   authenticated identity inside the action — no user/org/tenant/role
 *   data is accepted as an argument.
 * - Any non-`ok` reconciliation result is a hard failure: we throw so
 *   AuthKit's callback routes through `onError`, which redirects safely
 *   to `/support/access`. This keeps reconciliation failures visible to
 *   the user instead of silently succeeding the sign-in.
 * - `onError` never echoes the error, tokens, claims, organization ids,
 *   emails, or internal messages. It always redirects to the fixed
 *   support URL with cache-prevention headers.
 */

import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { fetchAction } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";

/**
 * Coarse error thrown when reconciliation did not complete with `ok`.
 * The message is deliberately generic; the real cause lives only in the
 * action's server-side logs and is never surfaced to the browser.
 */
class ReconcileFailedError extends Error {
  constructor() {
    super("Sign-in reconciliation could not be completed.");
    this.name = "ReconcileFailedError";
  }
}

export const GET = handleAuth({
  onSuccess: async ({ accessToken }) => {
    const result = await fetchAction(
      api.callback.reconcileWorkosCallback,
      {},
      // The access token is the ONLY thing forwarded. Convex validates it
      // and derives every identity field server-side.
      { token: accessToken },
    );

    if (result.status !== "ok") {
      // Route through onError so the user lands on a safe support page
      // rather than completing a half-reconciled sign-in.
      throw new ReconcileFailedError();
    }
  },
  onError: ({ request }) => {
    // Fixed destination; the original `error` is intentionally discarded
    // so no token, claim, organization id, email, or internal message is
    // reflected anywhere in the response.
    const url = new URL("/support/access", request.url);
    return NextResponse.redirect(url, {
      status: 303,
      headers: {
        "Cache-Control":
          "private, no-cache, no-store, must-revalidate, max-age=0",
        "x-middleware-cache": "no-cache",
      },
    });
  },
});
