import type { ReactNode } from "react";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireWorkosAuth } from "@/lib/auth/server";
import { canBypassWorkosAuth, hasWorkosAuthConfig } from "@/lib/auth/workos";
import { resolveTenantOrNotFound } from "@/lib/tenant/server";

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  // The [tenant] route parameter is a workspace slug; resolve it to the
  // trusted tenant id server-side. Unknown/disabled slugs 404 here.
  const tenantData = await resolveTenantOrNotFound(tenant);

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

  const auth = await requireWorkosAuth();

  const user = await fetchQuery(
    api.users.getCurrentUser,
    {},
    { token: auth.accessToken },
  );

  // Authorize the authenticated user against the server-resolved tenant
  // id — never the raw slug from the URL.
  if (!user || user.tenantId !== tenantData._id) {
    notFound();
  }

  return (
    <AdminShell tenantSlug={tenant} tenantName={tenantData.name}>
      {children}
    </AdminShell>
  );
}
