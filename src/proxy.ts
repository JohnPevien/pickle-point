import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { canBypassWorkosAuth, hasWorkosAuthConfig } from "@/lib/auth/workos";

const authkit = authkitProxy();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!hasWorkosAuthConfig(process.env)) {
    if (canBypassWorkosAuth(process.env)) {
      return NextResponse.next();
    }

    return NextResponse.json({ error: "WorkOS AuthKit is not configured." }, { status: 500 });
  }

  return authkit(request, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
