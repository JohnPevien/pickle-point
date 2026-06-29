/**
 * Thin wrapper around Convex server-to-server HTTP endpoints.
 *
 * The Next.js AuthKit callback uses this to invoke the
 * `/internal/reconcile-callback` HTTP action registered in
 * `convex/http.ts`. The bridge is gated on a deploy key
 * (`CONVEX_DEPLOY_KEY`) so the browser cannot call it.
 *
 * Errors surface as `Error` with the response body and status so
 * callers can decide whether to retry. We do NOT swallow failures;
 * the callback route surfaces them as a deterministic safe support
 * redirect.
 */

const getConvexUrl = (): string | null => {
  const value = process.env.NEXT_PUBLIC_CONVEX_URL;
  return value && value.length > 0 ? value : null;
};

const getConvexDeployKey = (): string => {
  const value = process.env.CONVEX_DEPLOY_KEY ?? "";
  return value;
};

/**
 * Invoke a Convex server-to-server HTTP endpoint by path. Server-only.
 * Browser code must NEVER call this. Errors are surfaced unchanged so
 * callers can decide whether to retry or fail closed.
 */
export async function invokeInternalAction<T = unknown>(
  path: string,
  args: unknown
): Promise<T> {
  const convexUrl = getConvexUrl();
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  const deployKey = getConvexDeployKey();
  if (!deployKey) {
    throw new Error(
      "CONVEX_DEPLOY_KEY is not configured; refusing to call internal Convex endpoint"
    );
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${convexUrl}${normalizedPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Convex-Deploy-Key": deployKey,
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Convex endpoint ${normalizedPath} failed: ${response.status} ${text}`
    );
  }

  return (await response.json()) as T;
}