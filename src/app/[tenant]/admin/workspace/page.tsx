import { fetchQuery } from "convex/nextjs";
import { notFound } from "next/navigation";
import { api } from "../../../../../convex/_generated/api";
import { WorkspaceSettingsForm } from "@/components/admin/WorkspaceSettingsForm";

export default async function AdminWorkspacePage({
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
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace Settings</h1>
        <p className="text-sm text-muted-foreground">
          Update workspace name, contact email, logo, and theme colors.
        </p>
      </div>
      <WorkspaceSettingsForm tenant={tenantData} />
    </main>
  );
}
