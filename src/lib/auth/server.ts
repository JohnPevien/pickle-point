import { withAuth } from "@workos-inc/authkit-nextjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { workosAuthRoutes } from "@/lib/auth/workos";

function getReturnPath(requestUrl: string | null) {
  if (!requestUrl) {
    return null;
  }

  try {
    const url = new URL(requestUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export async function requireWorkosAuth() {
  const auth = await withAuth();

  if (auth.user) {
    return auth;
  }

  const requestHeaders = await headers();
  const returnTo = getReturnPath(requestHeaders.get("x-url"));
  const returnToQuery = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";

  redirect(`${workosAuthRoutes.signIn}${returnToQuery}`);
}
