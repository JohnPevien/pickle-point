"use client";

import { Activity, Medal, Radio, Table2, Users } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildSessionLeaderboard,
  formatMatchingMode,
  formatSessionStatus,
  playerName,
  sortSessionPlayers,
  teamName,
} from "@/lib/open-play/helpers";

type LiveOpenPlayViewProps = {
  tenantName: string;
  sessionId: Id<"openPlaySessions">;
};

type PlayerDetails = Pick<Doc<"players">, "_id" | "firstName" | "lastName" | "manualSkillLevel"> | null;

type SessionPlayerRow = Doc<"sessionPlayers"> & {
  playerDetails: PlayerDetails;
};

type LiveMatch = Doc<"sessionMatches"> & {
  team1Details: PlayerDetails[];
  team2Details: PlayerDetails[];
};

export function LiveOpenPlayView({ tenantName, sessionId }: LiveOpenPlayViewProps) {
  const session = useQuery(api.openPlaySessions.getById, { sessionId });
  const sessionPlayers = useQuery(api.openPlaySessions.getSessionPlayers, { sessionId });
  const liveMatches = useQuery(api.openPlaySessions.getLiveMatches, { sessionId });
  const matchHistory = useQuery(api.openPlaySessions.getMatchHistory, { sessionId });

  const sortedSessionPlayers = useMemo(
    () => sortSessionPlayers((sessionPlayers ?? []) as SessionPlayerRow[]),
    [sessionPlayers],
  );
  const queuedPlayers = sortedSessionPlayers.filter((player) => player.status === "queued");
  const sittingOutPlayers = sortedSessionPlayers.filter((player) => player.status === "sitting_out");
  const activeMatches = ((liveMatches ?? []) as LiveMatch[]).filter((match) => match.status !== "completed");
  const completedMatches = (matchHistory ?? []) as LiveMatch[];
  const leaderboard = buildSessionLeaderboard(completedMatches);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b bg-card">
        <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{tenantName}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{session?.name ?? "Open Play"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {session ? `${formatSessionStatus(session.status)} / ${formatMatchingMode(session.matchingMode)}` : "Loading"}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Signal label="Courts" value={String(activeMatches.length)} icon={<Radio />} />
            <Signal label="Queue" value={String(queuedPlayers.length)} icon={<Users />} />
            <Signal label="Results" value={String(completedMatches.length)} icon={<Medal />} />
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Courts</CardTitle>
              <CardDescription>{activeMatches.length} live assignments</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {activeMatches.map((match) => (
                <div key={match._id} className="rounded-md border p-4">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <p className="font-semibold">{match.courtName ?? "Court"}</p>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize text-muted-foreground">
                      {match.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="grid gap-3 text-sm">
                    <TeamLine label="Team 1" value={teamName(match.team1Details)} />
                    <TeamLine label="Team 2" value={teamName(match.team2Details)} />
                  </div>
                </div>
              ))}
              {activeMatches.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No active courts.</div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Standings</CardTitle>
              <CardDescription>{leaderboard.length} players with results</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Player</th>
                      <th className="px-3 py-2 text-right font-medium">W</th>
                      <th className="px-3 py-2 text-right font-medium">L</th>
                      <th className="px-3 py-2 text-right font-medium">Diff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {leaderboard.map((standing) => (
                      <tr key={standing.id}>
                        <td className="px-3 py-2 font-medium">{standing.name}</td>
                        <td className="px-3 py-2 text-right">{standing.wins}</td>
                        <td className="px-3 py-2 text-right">{standing.losses}</td>
                        <td className="px-3 py-2 text-right">{standing.pointDiff}</td>
                      </tr>
                    ))}
                    {leaderboard.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                          No standings yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Up Next</CardTitle>
              <CardDescription>{queuedPlayers.length} queued players</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {queuedPlayers.slice(0, 10).map((player, index) => (
                <PlayerRow key={player._id} rank={index + 1} player={player} />
              ))}
              {queuedPlayers.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No queued players.</div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sitting Out</CardTitle>
              <CardDescription>{sittingOutPlayers.length} players</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {sittingOutPlayers.map((player) => (
                <PlayerRow key={player._id} player={player} />
              ))}
              {sittingOutPlayers.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No sit-outs.</div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Results</CardTitle>
              <CardDescription>{completedMatches.length} matches</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {completedMatches.slice(0, 6).map((match) => (
                <div key={match._id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate">{teamName(match.team1Details)}</span>
                    <span className="font-semibold">
                      {match.score1} - {match.score2}
                    </span>
                  </div>
                  <div className="mt-2 truncate text-muted-foreground">{teamName(match.team2Details)}</div>
                </div>
              ))}
              {completedMatches.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                  No completed results.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}

function Signal({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="mx-auto mb-1 flex size-6 items-center justify-center text-[var(--tenant-primary)]">{icon}</div>
      <p className="text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
    </div>
  );
}

function TeamLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function PlayerRow({ rank, player }: { rank?: number; player: SessionPlayerRow }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border px-3 py-2 text-sm">
      <div className="flex size-7 items-center justify-center rounded-md bg-muted text-xs font-semibold">
        {rank ?? <Table2 className="size-4" />}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">{playerName(player.playerDetails)}</p>
        <p className="truncate text-xs text-muted-foreground">{player.playerDetails?.manualSkillLevel ?? "Unrated"}</p>
      </div>
      <Activity className="size-4 text-[var(--tenant-primary)]" />
    </div>
  );
}
