import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { PlayerDirectoryAdminView } from "@/components/admin/PlayerDirectoryAdminView";

export default async function AdminPlayersPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });

  if (!tenantData) {
    notFound();
  }

  return (
    <PlayerDirectoryAdminView
      tenantId={tenantData._id}
      tenantName={tenantData.name}
      tenantSlug={tenant}
    />
  );
}
