import type { ReactNode } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { notFound } from "next/navigation";
import { canBypassWorkosAuth, hasWorkosAuthConfig } from "@/lib/auth/workos";

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  if (!hasWorkosAuthConfig(process.env)) {
    if (canBypassWorkosAuth(process.env)) {
      return <>{children}</>;
    }

    notFound();
  }

  const auth = await withAuth({ ensureSignedIn: true });
  const { tenant } = await params;

  // Verify the authenticated user owns this tenant
  const user = await fetchQuery(
    api.users.getCurrentUser,
    {},
    { token: auth.accessToken }
  );

  if (!user || user.tenantId !== tenant) {
    notFound();
  }

  return <>{children}</>;
}
