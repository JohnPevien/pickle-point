"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { generateBracketAction } from "@/app/actions/tournament";

type Team = {
  id: string;
  name: string;
  skillTier: string;
  players: string[];
};

type Tournament = {
  id: string;
  name: string;
  status: string | null;
  date: Date;
};

export function DashboardView({ 
  tenantId, 
  tournaments, 
  teams 
}: { 
  tenantId: string, 
  tournaments: Tournament[], 
  teams: Team[] 
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const activeTournament = tournaments.find(t => t.status === "registration_open" || t.status === "draft" || t.status === "in_progress");

  const handleGenerateBracket = () => {
    if (!activeTournament) return;
    
    startTransition(async () => {
      const res = await generateBracketAction(tenantId, activeTournament.id);
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error || "Failed");
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

  // Group teams securely for the UI
  const groupedTeams = teams.reduce((acc, t) => {
    if (!acc[t.skillTier]) acc[t.skillTier] = [];
    acc[t.skillTier].push(t);
    return acc;
  }, {} as Record<string, Team[]>);

  const tiers = ["Beginner", "Novice", "Low Intermediate", "Intermediate"];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{activeTournament.name}</h2>
          <p className="text-muted-foreground capitalize">Status: {activeTournament.status?.replace('_', ' ')}</p>
        </div>
        <div className="space-x-4">
           <Button 
             onClick={handleGenerateBracket} 
             disabled={isPending || activeTournament.status === "in_progress" || teams.length < 2}
             className="bg-[var(--tenant-primary)]"
           >
             {isPending ? "Processing..." : activeTournament.status === "in_progress" ? "Bracket Locked" : "Generate Bracket"}
           </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {tiers.map(tier => (
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
