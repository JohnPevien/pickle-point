import { VenueAdminView } from "@/components/admin/VenueAdminView";
import { resolveTenantOrNotFound } from "@/lib/tenant/server";

export default async function AdminVenuesPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const tenantData = await resolveTenantOrNotFound(tenant);

  return (
    <main className="container mx-auto space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Venues</h1>
        <p className="text-sm text-muted-foreground">Manage court counts and venue details.</p>
      </div>
      <VenueAdminView tenantId={tenantData._id} />
    </main>
  );
}
