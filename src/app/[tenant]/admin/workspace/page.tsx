import { withAuth } from "@workos-inc/authkit-nextjs";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "../../../../../convex/_generated/api";
import { WorkspaceSettingsForm } from "@/components/admin/WorkspaceSettingsForm";
import { Button } from "@/components/ui/button";
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
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link
              href={`/${tenant}/admin/dashboard`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              &larr; Dashboard
            </Link>
            <h1 className="text-xl font-bold text-[var(--tenant-primary)]">
              Workspace Settings
            </h1>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/${tenant}/admin/tournaments`}>Tournaments</Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8">
        <WorkspaceSettingsForm tenant={tenantData} />
      </main>
    </div>
  );
}
