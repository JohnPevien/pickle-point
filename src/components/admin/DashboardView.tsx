"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import {
  canGenerateDashboardBracket,
  dashboardBracketActionLabel,
  DASHBOARD_SKILL_TIERS,
  formatDashboardStatus,
  groupDashboardTeamsByTier,
} from "@/lib/admin/dashboard";

type Team = {
  id: string;
  name: string;
  skillTier: string;
  players: string[];
};

type Tournament = {
  _id: Id<"tournaments">;
  name: string;
  status: string;
  date: number;
};

export function DashboardView({
  tenantId,
  activeTournament,
  teams,
}: {
  tenantId: Id<"tenants">;
  activeTournament: Tournament | undefined;
  teams: Team[];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const generateBracket = useMutation(api.tournaments.generateBracket);

  const handleGenerateBracket = () => {
    if (!activeTournament) return;
    
    startTransition(async () => {
      try {
        const res = await generateBracket({ tenantId, tournamentId: activeTournament._id });
        if (res.success) {
          toast.success(res.message);
          router.refresh();
        } else {
          toast.error(res.error || "Failed");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to generate bracket.");
      }
    });
  };

  if (!activeTournament) {
    return (
      <Card className="text-center py-12">
        <CardHeader>
          <CardTitle>No Active Tournament</CardTitle>
          <CardDescription>You don&apos;t have any tournaments open for registration.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Tournament creation will be available soon.</p>
        </CardContent>
      </Card>
    );
  }

  const groupedTeams = groupDashboardTeamsByTier(teams);
  const canGenerateBracket = canGenerateDashboardBracket(activeTournament.status, teams.length);
  const bracketActionLabel = dashboardBracketActionLabel(activeTournament.status, isPending);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{activeTournament.name}</h2>
          <p className="text-muted-foreground capitalize">Status: {formatDashboardStatus(activeTournament.status)}</p>
        </div>
        <div className="space-x-4">
           <Button 
             onClick={handleGenerateBracket} 
             disabled={isPending || !canGenerateBracket}
             className="bg-[var(--tenant-primary)]"
           >
             {bracketActionLabel}
           </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {DASHBOARD_SKILL_TIERS.map(tier => (
          <Card key={tier}>
            <CardHeader className="bg-muted/40">
              <CardTitle className="text-lg">{tier}</CardTitle>
              <CardDescription>{groupedTeams[tier]?.length || 0} teams registered</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {groupedTeams[tier] && groupedTeams[tier].length > 0 ? (
                <ul className="divide-y">
                  {groupedTeams[tier].map(team => (
                    <li key={team.id} className="p-4 flex flex-col items-start hover:bg-muted/20">
                      <span className="font-semibold">{team.name}</span>
                      <span className="text-sm text-muted-foreground">{team.players.join(" & ")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No teams in this tier yet.
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
