import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export async function GET(request: Request) {
  const requestedReturnTo = new URL(request.url).searchParams.get("returnTo");
  const returnTo =
    requestedReturnTo?.startsWith("/") && !requestedReturnTo.startsWith("//")
      ? requestedReturnTo
      : undefined;
  const authorizationUrl = await getSignInUrl(returnTo ? { returnTo } : {});
  return redirect(authorizationUrl);
}
