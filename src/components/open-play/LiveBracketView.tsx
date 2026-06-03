"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import {
  statusLabel,
  formatLabel,
  formatTournamentDate,
  parseScore,
  groupBracketByTierAndStage,
  computeRoundRobinStandings,
  entrant2Label,
  isByeMatch,
  type TournamentStatus,
  type TournamentFormat,
  type MatchRow,
  type BracketRound,
} from "@/lib/tournament/helpers";

type Props = {
  tenantId: Id<"tenants">;
  tournamentId: Id<"tournaments">;
};

export function LiveBracketView({ tenantId, tournamentId }: Props) {
  const view = useQuery(api.tournaments.getTournamentView, { tenantId, tournamentId });

  if (view === undefined) {
    return <BracketSkeleton />;
  }

  if (view === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Tournament not available.</p>
      </div>
    );
  }

  const { tournament, teams, bracketRounds, summary } = view;
  const status = tournament.status as TournamentStatus;
  const format = tournament.format as TournamentFormat;
  const isRoundRobin = format === "round_robin";
  const grouped = groupBracketByTierAndStage(bracketRounds as BracketRound[]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold tracking-tight">{tournament.name}</h2>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
          <span>{formatLabel(format)}</span>
          <span>·</span>
          <span>{formatTournamentDate(tournament.date)}</span>
          {tournament.location && (
            <>
              <span>·</span>
              <span>{tournament.location}</span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Teams" value={summary.totalTeams} />
        <SummaryCard label="Matches" value={summary.totalMatches} />
        <SummaryCard label="Completed" value={summary.completedMatches} />
        <SummaryCard
          label="Remaining"
          value={summary.totalMatches - summary.completedMatches}
        />
      </div>

      {bracketRounds.length === 0 ? (
        <div className="rounded-md border px-6 py-12 text-center text-muted-foreground">
          Bracket has not been generated yet.
        </div>
      ) : (
        <div className="space-y-10">
          {grouped.map((tierGroup) => (
            <div key={tierGroup.tier} className="space-y-6">
              {grouped.length > 1 && (
                <h3 className="text-lg font-semibold border-b pb-2">{tierGroup.tier}</h3>
              )}
              {tierGroup.stages.map((stageGroup) => (
                <div key={stageGroup.stage} className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {stageGroup.stageLabel}
                  </h4>

                  {isRoundRobin && stageGroup.stage === "round_robin" && (
                    <PublicRoundRobinStandings
                      matches={stageGroup.rounds.flatMap((r) => r.matches) as MatchRow[]}
                      teams={teams
                        .filter((t) => t.skillTier === tierGroup.tier)
                        .map((t) => ({ id: t.id, name: t.name }))}
                    />
                  )}

                  <div className="space-y-2">
                    {stageGroup.rounds.map((round) => (
                      <div key={round.round} className="space-y-2">
                        <p className="text-xs text-muted-foreground font-medium">
                          Round {round.round}
                        </p>
                        {round.matches.map((match) => (
                          <PublicMatchCard key={match._id} match={match as MatchRow} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function PublicMatchCard({ match }: { match: MatchRow }) {
  const bye = isByeMatch(match);
  const e1Label = match.entrant1Name ?? "TBD";
  const e2Label = entrant2Label(match);

  const isCompleted = match.status === "completed";

  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${
        isCompleted ? "bg-muted/20 border-muted" : "bg-background"
      } ${match.isIfNecessary ? "border-dashed" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex-1 truncate font-medium ${
            match.winnerId === match.entrant1Id && isCompleted
              ? "text-foreground"
              : isCompleted
              ? "text-muted-foreground"
              : ""
          }`}
        >
          {e1Label}
        </span>
        {isCompleted && !bye ? (
          <span className="text-muted-foreground font-mono shrink-0">
            {parseScore(match.score1)} – {parseScore(match.score2)}
          </span>
        ) : (
          <span className="text-muted-foreground shrink-0">vs</span>
        )}
        <span
          className={`flex-1 truncate font-medium text-right ${
            match.winnerId === match.entrant2Id && isCompleted
              ? "text-foreground"
              : isCompleted
              ? "text-muted-foreground"
              : ""
          }`}
        >
          {e2Label}
        </span>
      </div>
      {match.isIfNecessary && (
        <p className="text-xs text-muted-foreground mt-0.5">If necessary</p>
      )}
    </div>
  );
}

function PublicRoundRobinStandings({
  matches,
  teams,
}: {
  matches: MatchRow[];
  teams: { id: string; name: string }[];
}) {
  const standings = computeRoundRobinStandings(matches, teams);

  return (
    <div className="rounded-md border overflow-hidden mb-2">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide">#</th>
            <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide">Team</th>
            <th className="text-center px-3 py-2 font-medium text-xs uppercase tracking-wide">W</th>
            <th className="text-center px-3 py-2 font-medium text-xs uppercase tracking-wide">L</th>
            <th className="text-center px-3 py-2 font-medium text-xs uppercase tracking-wide">+/-</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {standings.map((s, i) => (
            <tr key={s.entrantId} className="hover:bg-muted/20">
              <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
              <td className="px-3 py-2 font-medium">{s.entrantName}</td>
              <td className="px-3 py-2 text-center">{s.wins}</td>
              <td className="px-3 py-2 text-center">{s.losses}</td>
              <td className="px-3 py-2 text-center">
                {s.pointsFor - s.pointsAgainst > 0 ? "+" : ""}
                {s.pointsFor - s.pointsAgainst}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BracketSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-muted rounded w-1/2" />
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-muted rounded" />
        ))}
      </div>
      <div className="h-48 bg-muted rounded" />
    </div>
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "live":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "completed":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    case "cancelled":
      return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
    case "registration_open":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}
