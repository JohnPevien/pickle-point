import type { ReactNode } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { notFound } from "next/navigation";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { getDocsAccessMode } from "@/lib/docs/access";
import { source } from "@/lib/source";

export const dynamic = "force-dynamic";

async function requireDocsAccess() {
  const mode = getDocsAccessMode(process.env);

  if (mode === "public_local") {
    return;
  }

  if (mode === "unavailable") {
    notFound();
  }

  await withAuth({ ensureSignedIn: true });
}

export default async function Layout({ children }: { children: ReactNode }) {
  await requireDocsAccess();

  return (
    <DocsLayout {...baseOptions()} tree={source.getPageTree()}>
      {children}
    </DocsLayout>
  );
}
