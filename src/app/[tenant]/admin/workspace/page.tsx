import { fetchQuery } from "convex/nextjs";
import { notFound } from "next/navigation";
import { api } from "../../../../../convex/_generated/api";
import { WorkspaceSettingsForm } from "@/components/admin/WorkspaceSettingsForm";
import { requireWorkosAuth } from "@/lib/auth/server";
import { hasWorkosAuthConfig } from "@/lib/auth/workos";

export const dynamic = "force-dynamic";

async function getAuthorizedWorkspace(tenant: string) {
  // The workspace-settings page edits owner-only fields (contact email,
  // branding), so it always requires an owner session via
  // getCurrentWorkspace. There is intentionally no public/dev bypass:
  // without an owner identity the page renders "not found" rather than
  // exposing owner data through a public projection.
  if (!hasWorkosAuthConfig(process.env)) {
    notFound();
  }

  const auth = await requireWorkosAuth();
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
