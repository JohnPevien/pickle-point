import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { notFound } from "next/navigation";
import Link from "next/link";
import { LiveBracketView } from "@/components/open-play/LiveBracketView";

export default async function PublicTournamentPage({
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
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm"
              style={{ backgroundColor: "var(--tenant-primary)" }}
            >
              {tenantData.name.charAt(0)}
            </div>
            <span className="font-semibold">{tenantData.name}</span>
          </div>
          <Link
            href={`/${tenant}/register`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Register a Team
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <LiveBracketView
          tenantId={tenantData._id}
          tournamentId={view.tournament._id}
        />
      </main>
    </div>
  );
}
