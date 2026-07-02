import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { DashboardView } from "@/components/admin/DashboardView";
import { requireWorkosAuth } from "@/lib/auth/server";
import { resolveTenantOrNotFound } from "@/lib/tenant/server";

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;

  const tenantData = await resolveTenantOrNotFound(tenant);

  const auth = await requireWorkosAuth();
  const allTournaments = await fetchQuery(
    api.tournaments.listByTenant,
    { tenantId: tenantData._id },
    { token: auth.accessToken },
  );

  const activeT = allTournaments.find(
    (t) =>
      t.status === "registration_open" ||
      t.status === "draft" ||
      t.status === "bracket_generated" ||
      t.status === "live",
  );

  let registeredTeams: { id: string; name: string; skillTier: string; players: string[] }[] = [];

  if (activeT) {
    registeredTeams = await fetchQuery(api.tournaments.getRegisteredTeams, {
      tournamentId: activeT._id,
    });
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <DashboardView tenantId={tenantData._id} activeTournament={activeT} teams={registeredTeams} />
    </main>
  );
}
