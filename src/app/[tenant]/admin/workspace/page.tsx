import { withAuth } from "@workos-inc/authkit-nextjs";
import { fetchQuery } from "convex/nextjs";
import { notFound } from "next/navigation";
import { api } from "../../../../../convex/_generated/api";
import { WorkspaceSettingsForm } from "@/components/admin/WorkspaceSettingsForm";
import { canBypassWorkosAuth, hasWorkosAuthConfig } from "@/lib/auth/workos";

export const dynamic = "force-dynamic";

async function getAuthorizedWorkspace(tenant: string) {
  if (hasWorkosAuthConfig(process.env)) {
    const auth = await withAuth({ ensureSignedIn: true });
    const currentWorkspace = await fetchQuery(
      api.tenants.getCurrentWorkspace,
      {},
      { token: auth.accessToken }
    );

    if (!currentWorkspace || currentWorkspace.tenant._id !== tenant) {
      notFound();
    }

    return currentWorkspace.tenant;
  }

  if (!canBypassWorkosAuth(process.env)) {
    notFound();
  }

  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });
  if (!tenantData) {
    notFound();
  }

  return tenantData;
}

export default async function AdminWorkspacePage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const tenantData = await getAuthorizedWorkspace(tenant);

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
