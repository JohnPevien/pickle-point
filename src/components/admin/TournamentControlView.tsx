"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { Copy, ExternalLink, QrCode } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SessionQrPanel } from "@/components/open-play/SessionQrPanel";
import {
  statusLabel,
  formatLabel,
  formatTournamentDate,
  buildPublicTournamentUrl,
  parseScore,
  groupBracketByTierAndStage,
  computeRoundRobinStandings,
  entrant2Label,
  isByeMatch,
  TIER_ORDER,
  type TournamentStatus,
  type TournamentFormat,
  type MatchRow,
} from "@/lib/tournament/helpers";

const STATUS_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  draft: ["registration_open", "cancelled"],
  registration_open: ["registration_closed", "cancelled"],
  registration_closed: ["registration_open", "cancelled"],
  bracket_generated: ["live", "registration_closed", "cancelled"],
  live: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

type Props = {
  tenantId: Id<"tenants">;
  tournamentId: Id<"tournaments">;
  tenant: string;
};

type ScoreEntry = { score1: string; score2: string };

export function TournamentControlView({ tenantId, tournamentId, tenant }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [scoreEntries, setScoreEntries] = useState<Record<string, ScoreEntry>>({});
  const [activeTier, setActiveTier] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  const view = useQuery(api.tournaments.getTournamentView, { tenantId, tournamentId });
  const updateStatus = useMutation(api.tournaments.updateTournamentStatus);
  const generateBracket = useMutation(api.tournaments.generateBracket);
  const recordScore = useMutation(api.tournaments.recordTournamentScore);

  if (view === undefined) {
    return <LoadingSkeleton />;
  }

  if (view === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Tournament not found.</p>
      </div>
    );
  }

  const { tournament, teams, bracketRounds, summary } = view;
  const status = tournament.status as TournamentStatus;
  const format = tournament.format as TournamentFormat;
  const allowedTransitions = STATUS_TRANSITIONS[status] ?? [];
  const publicPath = `/${tenant}/tournaments/${tournamentId}`;
  const publicUrl = typeof window === "undefined"
    ? publicPath
    : buildPublicTournamentUrl(window.location.origin, tenant, tournamentId);
  const isRoundRobin = format === "round_robin";

  const grouped = groupBracketByTierAndStage(
    bracketRounds as Parameters<typeof groupBracketByTierAndStage>[0]
  );
  const activeTierData = activeTier
    ? grouped.find((g) => g.tier === activeTier) ?? grouped[0]
    : grouped[0];

  function handleStatusTransition(next: TournamentStatus) {
    startTransition(async () => {
      try {
        const res = await updateStatus({ tenantId, tournamentId, status: next });
        if (res.success) {
          toast.success(`Status updated to ${statusLabel(next)}`);
          router.refresh();
        } else {
          toast.error(res.error ?? "Failed to update status.");
        }
      } catch {
        toast.error("Failed to update status.");
      }
    });
  }

  function handleGenerateBracket() {
    startTransition(async () => {
      try {
        const res = await generateBracket({ tenantId, tournamentId });
        if (res.success) {
          toast.success(res.message ?? "Bracket generated.");
          router.refresh();
        } else {
          toast.error(res.error ?? "Failed to generate bracket.");
        }
      } catch {
        toast.error("Failed to generate bracket.");
      }
    });
  }

  function handleScoreChange(matchId: string, field: "score1" | "score2", value: string) {
    setScoreEntries((prev) => ({
      ...prev,
      [matchId]: { ...(prev[matchId] ?? { score1: "", score2: "" }), [field]: value },
    }));
  }

  function handleRecordScore(matchId: Id<"tournamentMatches">) {
    const entry = scoreEntries[matchId];
    if (!entry) return;
    // Reject blank inputs explicitly: Number("") is 0, which would otherwise
    // be accepted as a valid score and could submit a 0-0 record.
    if (entry.score1.trim() === "" || entry.score2.trim() === "") {
      toast.error("Enter a score for both teams.");
      return;
    }
    const s1Raw = Number(entry.score1);
    const s2Raw = Number(entry.score2);
    if (!Number.isInteger(s1Raw) || !Number.isInteger(s2Raw) || s1Raw < 0 || s2Raw < 0) {
      toast.error("Scores must be non-negative whole numbers.");
      return;
    }
    const s1 = s1Raw;
    const s2 = s2Raw;
    startTransition(async () => {
      try {
        const res = await recordScore({ tenantId, matchId, score1: s1, score2: s2 });
        if (res.success) {
          toast.success("Score recorded.");
          setScoreEntries((prev) => {
            const next = { ...prev };
            delete next[matchId];
            return next;
          });
        } else {
          toast.error(res.error ?? "Failed to record score.");
        }
      } catch {
        toast.error("Failed to record score.");
      }
    });
  }

  async function handleCopyLink() {
    if (!navigator.clipboard) {
      toast.error("Clipboard is unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Public link copied.");
    } catch {
      toast.error("Unable to copy link.");
    }
  }

  const canGenerateBracket =
    status === "draft" ||
    status === "registration_open" ||
    status === "registration_closed";

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{tournament.name}</h2>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(status)}`}>
              {statusLabel(status)}
            </span>
            <span className="text-sm text-muted-foreground">{formatLabel(format)}</span>
            <span className="text-sm text-muted-foreground">{formatTournamentDate(tournament.date)}</span>
            {tournament.location && (
              <span className="text-sm text-muted-foreground">{tournament.location}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {allowedTransitions
            .filter((s) => s !== "cancelled")
            .map((next) => (
              <Button
                key={next}
                size="sm"
                disabled={isPending}
                onClick={() => handleStatusTransition(next)}
                style={{ backgroundColor: "var(--tenant-primary)" }}
              >
                → {statusLabel(next)}
              </Button>
            ))}
          {allowedTransitions.includes("cancelled") && (
            <Button
              size="sm"
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
              disabled={isPending}
              onClick={() => handleStatusTransition("cancelled")}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard label="Teams" value={summary.totalTeams} />
        <MetricCard label="Matches" value={summary.totalMatches} />
        <MetricCard label="Completed" value={summary.completedMatches} />
        <MetricCard
          label="Remaining"
          value={summary.totalMatches - summary.completedMatches}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {canGenerateBracket && (
          <Button
            size="sm"
            disabled={isPending || teams.length < 2}
            onClick={handleGenerateBracket}
            variant="outline"
          >
            {bracketRounds.length > 0 ? "Regenerate Bracket" : "Generate Bracket"}
          </Button>
        )}
        {bracketRounds.length > 0 && (
          <>
            <Button size="sm" variant="outline" onClick={handleCopyLink}>
              <Copy className="mr-2 h-4 w-4" />
              Copy Public Link
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowQr((current) => !current)}
              aria-expanded={showQr}
            >
              <QrCode className="mr-2 h-4 w-4" />
              {showQr ? "Hide QR" : "Show QR"}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={publicPath} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Public View
              </Link>
            </Button>
          </>
        )}
      </div>

      {showQr && bracketRounds.length > 0 && (
        <div className="flex justify-start">
          <SessionQrPanel
            url={publicUrl}
            title="Tournament public bracket"
            ariaLabel="Tournament public bracket QR code"
          />
        </div>
      )}

      <RegisteredTeams teams={teams as Parameters<typeof RegisteredTeams>[0]["teams"]} />

      {bracketRounds.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Bracket</h3>

          {grouped.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {grouped.map((g) => (
                <button
                  key={g.tier}
                  onClick={() => setActiveTier(g.tier)}
                  className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                    (activeTier ?? grouped[0]?.tier) === g.tier
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-primary"
                  }`}
                >
                  {g.tier}
                </button>
              ))}
            </div>
          )}

          {activeTierData && (
            <div className="space-y-6">
              {activeTierData.stages.map((stageGroup) => (
                <div key={stageGroup.stage} className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {stageGroup.stageLabel}
                  </h4>

                  {isRoundRobin && stageGroup.stage === "round_robin" && (
                    <RoundRobinStandings
                      matches={stageGroup.rounds.flatMap((r) => r.matches) as MatchRow[]}
                      teams={teams
                        .filter((t) => t.skillTier === activeTierData.tier)
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
                          <MatchCard
                            key={match._id}
                            match={match as MatchRow}
                            scoreEntry={scoreEntries[match._id] ?? { score1: "", score2: "" }}
                            onScoreChange={(field, value) =>
                              handleScoreChange(match._id, field, value)
                            }
                            onRecordScore={() =>
                              handleRecordScore(match._id as Id<"tournamentMatches">)
                            }
                            disabled={isPending}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

type TeamRow = {
  id: string;
  name: string;
  skillTier: string;
  players: string[];
};

function RegisteredTeams({ teams }: { teams: TeamRow[] }) {
  const grouped = TIER_ORDER.reduce((acc, tier) => {
    const tierTeams = teams.filter((t) => t.skillTier === tier);
    if (tierTeams.length > 0) acc[tier] = tierTeams;
    return acc;
  }, {} as Record<string, TeamRow[]>);

  const activeTiers = Object.keys(grouped);

  if (activeTiers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registered Teams</CardTitle>
          <CardDescription>No teams registered yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">
        Registered Teams <span className="text-muted-foreground font-normal text-sm">({teams.length})</span>
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {activeTiers.map((tier) => (
          <Card key={tier}>
            <CardHeader className="pb-2 bg-muted/30">
              <CardTitle className="text-sm">{tier}</CardTitle>
              <CardDescription className="text-xs">
                {grouped[tier].length} team{grouped[tier].length !== 1 ? "s" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {grouped[tier].map((team) => (
                  <li key={team.id} className="px-4 py-2">
                    <p className="text-sm font-medium">{team.name}</p>
                    <p className="text-xs text-muted-foreground">{team.players.join(" & ")}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RoundRobinStandings({
  matches,
  teams,
}: {
  matches: MatchRow[];
  teams: { id: string; name: string }[];
}) {
  const standings = computeRoundRobinStandings(matches, teams);

  return (
    <div className="rounded-md border overflow-hidden">
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

function MatchCard({
  match,
  scoreEntry,
  onScoreChange,
  onRecordScore,
  disabled,
}: {
  match: MatchRow;
  scoreEntry: ScoreEntry;
  onScoreChange: (field: "score1" | "score2", value: string) => void;
  onRecordScore: () => void;
  disabled: boolean;
}) {
  const bye = isByeMatch(match);
  const e1Label = match.entrant1Name ?? "TBD";
  const e2Label = entrant2Label(match);

  const isCompleted = match.status === "completed";
  const canScore = !isCompleted && !!match.entrant1Id && !!match.entrant2Id && !bye;

  return (
    <div
      className={`rounded-md border px-3 py-2 flex items-center gap-3 text-sm ${
        isCompleted ? "bg-muted/20 border-muted" : "bg-background"
      } ${match.isIfNecessary ? "border-dashed" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`truncate font-medium ${
              match.winnerId === match.entrant1Id && isCompleted
                ? "text-foreground"
                : isCompleted
                ? "text-muted-foreground"
                : ""
            }`}
          >
            {e1Label}
          </span>
          <span className="text-muted-foreground shrink-0">
            {parseScore(match.score1)} – {parseScore(match.score2)}
          </span>
          <span
            className={`truncate font-medium ${
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
          <span className="text-xs text-muted-foreground">If necessary</span>
        )}
      </div>

      {canScore && (
        <div className="flex items-center gap-1 shrink-0">
          <Input
            type="number"
            min={0}
            value={scoreEntry.score1}
            onChange={(e) => onScoreChange("score1", e.target.value)}
            className="w-14 h-7 text-center text-xs px-1"
            placeholder="0"
            disabled={disabled}
          />
          <span className="text-muted-foreground text-xs">–</span>
          <Input
            type="number"
            min={0}
            value={scoreEntry.score2}
            onChange={(e) => onScoreChange("score2", e.target.value)}
            className="w-14 h-7 text-center text-xs px-1"
            placeholder="0"
            disabled={disabled}
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onRecordScore}
            disabled={disabled || !scoreEntry.score1 || !scoreEntry.score2}
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-muted rounded w-1/3" />
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-muted rounded" />
        ))}
      </div>
      <div className="h-64 bg-muted rounded" />
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
