import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { notFound } from "next/navigation";
import { DashboardView } from "@/components/admin/DashboardView";

export default async function AdminDashboardPage({ params }: { params: { tenant: string } }) {
  const { tenant } = params;

  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });

  if (!tenantData) {
    notFound();
  }

  // Fetch all tournaments for this tenant
  const allTournaments = await fetchQuery(api.tournaments.listByTenant, { tenantId: tenantData._id });

  // Determine active tournament if any
  const activeT = allTournaments.find(t => t.status === "registration_open" || t.status === "draft" || t.status === "bracket_generated" || t.status === "live");

  let registeredTeams: { id: string, name: string, skillTier: string, players: string[] }[] = [];

  if (activeT) {
    const teamsList = await fetchQuery(api.tournaments.getRegisteredTeams, { tournamentId: activeT._id });
    registeredTeams = teamsList.map(t => ({
      id: t.id,
      name: t.name,
      skillTier: t.skillTier,
      players: t.players
    }));
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <h1 className="font-bold text-xl" style={{ color: "var(--tenant-primary)" }}>
            {tenantData.name} - Game Master Dashboard
          </h1>
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-primary-foreground font-bold" style={{ backgroundColor: "var(--tenant-primary)" }}>
            {tenantData.name.charAt(0)}
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <DashboardView 
          tenantId={tenantData._id} 
          tournaments={allTournaments as any[]} 
          teams={registeredTeams} 
        />
      </main>
    </div>
  );
}
