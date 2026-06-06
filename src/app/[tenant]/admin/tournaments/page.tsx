import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TournamentListView } from "@/components/admin/TournamentListView";

export default async function AdminTournamentsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;

  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });
  if (!tenantData) notFound();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/${tenant}/admin/dashboard`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Dashboard
            </Link>
            <h1 className="font-bold text-xl" style={{ color: "var(--tenant-primary)" }}>
              Tournaments
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/${tenant}/admin/players`}>Players</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${tenant}/register`}>Register Team</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <TournamentListView tenantId={tenantData._id} tenant={tenant} />
      </main>
    </div>
  );
}

