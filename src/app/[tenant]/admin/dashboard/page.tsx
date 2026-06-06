import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DashboardView } from "@/components/admin/DashboardView";
import { Button } from "@/components/ui/button";

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;

  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });

  if (!tenantData) {
    notFound();
  }

  // Fetch all tournaments for this tenant
  const allTournaments = await fetchQuery(api.tournaments.listByTenant, { tenantId: tenantData._id });

  // Determine active tournament if any
  const activeT = allTournaments.find(t => t.status === "registration_open" || t.status === "draft" || t.status === "bracket_generated" || t.status === "live");

  let registeredTeams: { id: string; name: string; skillTier: string; players: string[] }[] = [];

  if (activeT) {
    registeredTeams = await fetchQuery(api.tournaments.getRegisteredTeams, { tournamentId: activeT._id });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <h1 className="font-bold text-xl" style={{ color: "var(--tenant-primary)" }}>
            {tenantData.name} - Game Master Dashboard
          </h1>
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href={`/${tenant}/admin/tournaments`}>Tournaments</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${tenant}/admin/players`}>Players</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${tenant}/admin/open-play`}>Open Play</Link>
            </Button>
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-primary-foreground font-bold" style={{ backgroundColor: "var(--tenant-primary)" }}>
              {tenantData.name.charAt(0)}
            </div>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <DashboardView
          tenantId={tenantData._id}
          activeTournament={activeT}
          teams={registeredTeams}
        />
      </main>
    </div>
  );
}
