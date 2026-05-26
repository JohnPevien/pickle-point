import { refreshSession, withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const forceRefreshToken = new URL(request.url).searchParams.get("refresh") === "1";

  try {
    const auth = forceRefreshToken ? await refreshSession() : await withAuth();

    if (!auth.user || !auth.accessToken) {
      return NextResponse.json({ accessToken: null }, { status: 401 });
    }

    return NextResponse.json({
      accessToken: auth.accessToken,
    });
  } catch {
    return NextResponse.json({ accessToken: null }, { status: 401 });
  }
}
