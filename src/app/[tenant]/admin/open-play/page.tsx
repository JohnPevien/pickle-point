import { OpenPlayControlView } from "@/components/admin/OpenPlayControlView";
import { resolveTenantOrNotFound } from "@/lib/tenant/server";

export default async function AdminOpenPlayPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const tenantData = await resolveTenantOrNotFound(tenant);

  return (
    <OpenPlayControlView
      tenantId={tenantData._id}
      tenantName={tenantData.name}
      tenantSlug={tenant}
    />
  );
}
