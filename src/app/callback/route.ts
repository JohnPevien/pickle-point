/**
 * WorkOS AuthKit callback route.
 *
 * - `handleAuth()` performs the full OAuth/PKCE dance, verifies state,
 *   exchanges the authorization code, sets the AuthKit session cookie,
 *   and redirects to the requested return path. We do NOT customise
 *   the PKCE cookie handling.
 * - `onSuccess` runs only after a successful authentication. We use it
 *   to invoke the server-to-server reconcile helper, which extracts
 *   the organization + role from the access token JWT (not from the
 *   browser) and asks Convex to upsert the user + membership
 *   projection. No tenant, role, or organization authority is
 *   accepted from the browser.
 *
 * Failure of the reconciliation step returns the safe support route
 * returned by `reconcileWorkosCallback`. We do not abort the AuthKit
 * sign-in itself — the user still has a valid AuthKit session.
 */

import { handleAuth } from "@workos-inc/authkit-nextjs";
import { reconcileWorkosCallback } from "@/lib/auth/reconcile";

export const GET = handleAuth({
  onSuccess: async ({ user, accessToken }) => {
    await reconcileWorkosCallback({
      user: {
        id: user.id,
        email: user.email ?? undefined,
        firstName: user.firstName ?? undefined,
        lastName: user.lastName ?? undefined,
      },
      accessToken,
    });
  },
});