import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { notFound } from "next/navigation";
import Link from "next/link";
import { TournamentControlView } from "@/components/admin/TournamentControlView";

export default async function AdminTournamentDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; tournamentId: string }>;
}) {
  const { tenant, tournamentId } = await params;

  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });
  if (!tenantData) notFound();

  const view = await fetchQuery(api.tournaments.getTournamentView, {
    tenantId: tenantData._id,
    tournamentId: tournamentId as Id<"tournaments">,
  });

  if (!view) notFound();

  return (
    <main className="container mx-auto space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{view.tournament.name}</h1>
        <Link
          href={`/${tenant}/tournaments/${tournamentId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Public view ↗
        </Link>
      </div>
      <TournamentControlView
        tenantId={tenantData._id}
        tournamentId={view.tournament._id}
        tenant={tenant}
      />
    </main>
  );
}
