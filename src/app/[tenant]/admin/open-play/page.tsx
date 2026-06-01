import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { OpenPlayControlView } from "@/components/admin/OpenPlayControlView";

export default async function AdminOpenPlayPage({
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
    <OpenPlayControlView
      tenantId={tenantData._id}
      tenantName={tenantData.name}
      tenantSlug={tenant}
    />
  );
}
