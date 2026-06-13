import { withAuth } from "@workos-inc/authkit-nextjs";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { WorkspaceSetupForm } from "@/components/setup/WorkspaceSetupForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canBypassWorkosAuth, hasWorkosAuthConfig } from "@/lib/auth/workos";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!hasWorkosAuthConfig(process.env)) {
    if (canBypassWorkosAuth(process.env)) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <CardTitle>Authentication setup required</CardTitle>
              <CardDescription>
                Configure WorkOS and Convex auth before creating an authenticated workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              The first-run setup flow creates the workspace from your signed-in identity, so it
              cannot run while WorkOS auth is disabled.
            </CardContent>
          </Card>
        </main>
      );
    }

    return redirect("/sign-in");
  }

  const auth = await withAuth({ ensureSignedIn: true });

  let currentWorkspace: Awaited<ReturnType<typeof fetchQuery>> | null = null;
  try {
    currentWorkspace = await fetchQuery(
      api.tenants.getCurrentWorkspace,
      {},
      { token: auth.accessToken }
    );
  } catch (error) {
    console.error("Failed to load current workspace", error);
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>Setup temporarily unavailable</CardTitle>
            <CardDescription>
              We could not load your workspace from Convex. Please try again in a moment.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (currentWorkspace) {
    redirect(`/${currentWorkspace.tenant._id}/admin/dashboard`);
  }

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="space-y-2 text-center sm:text-left">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Pickle Point setup
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Create your first workspace</h1>
          <p className="text-muted-foreground">
            Set the name, contact details, and theme that players and admins will see.
          </p>
        </div>
        <WorkspaceSetupForm defaultContactEmail={auth.user?.email ?? ""} />
      </div>
    </main>
  );
}
