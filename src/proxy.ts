import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { hasWorkosAuthConfig } from "@/lib/auth/workos";

const authkit = authkitProxy();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!hasWorkosAuthConfig(process.env)) {
    return NextResponse.next();
  }

  return authkit(request, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
