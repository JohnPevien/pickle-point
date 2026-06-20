import type { ReactNode } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { notFound, redirect } from "next/navigation";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { canBypassWorkosAuth, hasWorkosAuthConfig } from "@/lib/auth/workos";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: ReactNode }) {
  if (!hasWorkosAuthConfig(process.env)) {
    if (!canBypassWorkosAuth(process.env)) {
      notFound();
    }
  } else {
    const auth = await withAuth();
    if (!auth.user) {
      return redirect("/sign-in");
    }
  }

  return (
    <DocsLayout {...baseOptions()} tree={source.getPageTree()}>
      {children}
    </DocsLayout>
  );
}
