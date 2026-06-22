import { withAuth } from "@workos-inc/authkit-nextjs";
import { createFromSource } from "fumadocs-core/search/server";
import { NextResponse } from "next/server";
import { getDocsAccessMode } from "@/lib/docs/access";
import { source } from "@/lib/source";

const search = createFromSource(source);

export async function GET(request: Request) {
  const mode = getDocsAccessMode(process.env);

  if (mode === "unavailable") {
    return NextResponse.json({ error: "Docs are unavailable." }, { status: 404 });
  }

  if (mode === "authenticated") {
    await withAuth({ ensureSignedIn: true });
  }

  return search.GET(request);
}
