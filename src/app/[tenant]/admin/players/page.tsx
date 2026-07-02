import { PlayerDirectoryAdminView } from "@/components/admin/PlayerDirectoryAdminView";
import { resolveTenantOrNotFound } from "@/lib/tenant/server";

export default async function AdminPlayersPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const tenantData = await resolveTenantOrNotFound(tenant);

  return (
    <PlayerDirectoryAdminView tenantId={tenantData._id} tenantName={tenantData.name} />
  );
}
