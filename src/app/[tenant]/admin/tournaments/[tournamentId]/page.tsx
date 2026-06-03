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
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/${tenant}/admin/tournaments`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Tournaments
            </Link>
            <h1 className="font-bold text-xl truncate" style={{ color: "var(--tenant-primary)" }}>
              {view.tournament.name}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/${tenant}/tournaments/${tournamentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Public view ↗
            </Link>
            <div
              className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold"
              style={{ backgroundColor: "var(--tenant-primary)", color: "#fff" }}
            >
              {tenantData.name.charAt(0)}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <TournamentControlView
          tenantId={tenantData._id}
          tournamentId={view.tournament._id}
          tenant={tenant}
        />
      </main>
    </div>
  );
}
