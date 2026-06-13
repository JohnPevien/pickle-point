import type { ReactNode } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { canBypassWorkosAuth, hasWorkosAuthConfig } from "@/lib/auth/workos";

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });

  if (!tenantData) {
    notFound();
  }

  if (!hasWorkosAuthConfig(process.env)) {
    if (canBypassWorkosAuth(process.env)) {
      return (
        <AdminShell tenantSlug={tenant} tenantName={tenantData.name}>
          {children}
        </AdminShell>
      );
    }

    notFound();
  }

  const auth = await withAuth({ ensureSignedIn: true });

  const user = await fetchQuery(
    api.users.getCurrentUser,
    {},
    { token: auth.accessToken },
  );

  if (!user || user.tenantId !== tenant) {
    notFound();
  }

  return (
    <AdminShell tenantSlug={tenant} tenantName={tenantData.name}>
      {children}
    </AdminShell>
  );
}
