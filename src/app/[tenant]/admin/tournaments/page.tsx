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
    <main className="container mx-auto space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tournaments</h1>
          <p className="text-sm text-muted-foreground">Create and manage bracket events.</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={`/${tenant}/register`}>Register Team</Link>
        </Button>
      </div>
      <TournamentListView tenantId={tenantData._id} tenant={tenant} />
    </main>
  );
}
