import { db } from "@/lib/db";
import { tenants, tournaments, teams, tournamentTeams, teamMembers, participants } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { DashboardView } from "@/components/admin/DashboardView";

export default async function AdminDashboardPage({ params }: { params: { tenant: string } }) {
  const { tenant } = params;

  const [tenantData] = await db.select().from(tenants).where(eq(tenants.id, tenant));

  if (!tenantData) {
    notFound();
  }

  // Fetch all tournaments for this tenant
  const allTournaments = await db.select().from(tournaments)
    .where(eq(tournaments.tenantId, tenant))
    .orderBy(desc(tournaments.createdAt));

  // Determine active tournament if any
  const activeT = allTournaments.find(t => t.status === "registration_open" || t.status === "draft" || t.status === "in_progress");

  let registeredTeams: { id: string, name: string, skillTier: string, players: string[] }[] = [];

  if (activeT) {
    const teamsList = await db
      .select({
        id: teams.id,
        name: teams.name,
        skillTier: teams.skillTier,
      })
      .from(teams)
      .innerJoin(tournamentTeams, eq(teams.id, tournamentTeams.teamId))
      .where(eq(tournamentTeams.tournamentId, activeT.id));

    if (teamsList.length > 0) {
      const teamIds = teamsList.map(t => t.id);
      const membersList = await db
        .select({
            teamId: teamMembers.teamId,
            firstName: participants.firstName,
            lastName: participants.lastName
        })
        .from(teamMembers)
        .innerJoin(participants, eq(teamMembers.participantId, participants.id))
        .where(inArray(teamMembers.teamId, teamIds));
        
      const teamPlayersMap = membersList.reduce((acc, m) => {
          if (!acc[m.teamId]) acc[m.teamId] = [];
          acc[m.teamId].push(`${m.firstName} ${m.lastName}`);
          return acc;
      }, {} as Record<string, string[]>);
      
      registeredTeams = teamsList.map(t => ({
          ...t,
          players: teamPlayersMap[t.id] || []
      }));
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <h1 className="font-bold text-xl" style={{ color: "var(--tenant-primary)" }}>
            {tenantData.name} - Game Master Dashboard
          </h1>
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold">
            {tenantData.name.charAt(0)}
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <DashboardView 
          tenantId={tenant} 
          tournaments={allTournaments} 
          teams={registeredTeams} 
        />
      </main>
    </div>
  );
}
