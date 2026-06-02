"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Play,
  Plus,
  Radio,
  RotateCw,
  UserPlus,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MATCHING_MODES,
  SESSION_STATUSES,
  SKILL_TIERS,
  type MatchingMode,
  type SessionStatus,
  formatMatchingMode,
  formatSessionStatus,
  parseScoreInput,
  parseSessionDateInput,
  playerName,
  sortSessionPlayers,
  teamName,
  toDatetimeLocalValue,
} from "@/lib/open-play/helpers";

type OpenPlayControlViewProps = {
  tenantId: Id<"tenants">;
  tenantName: string;
  tenantSlug: string;
};

type PlayerDetails = Pick<Doc<"players">, "_id" | "firstName" | "lastName" | "manualSkillLevel"> | null;

type SessionPlayerRow = Doc<"sessionPlayers"> & {
  playerDetails: PlayerDetails;
};

type LiveMatch = Doc<"sessionMatches"> & {
  team1Details: PlayerDetails[];
  team2Details: PlayerDetails[];
};

const ACTIVE_STATUSES = new Set(["pending", "in_progress"]);

export function OpenPlayControlView({ tenantId, tenantName, tenantSlug }: OpenPlayControlViewProps) {
  const sessions = useQuery(api.openPlaySessions.listByTenant, { tenantId, limit: 25 });
  const players = useQuery(api.players.listByTenant, { tenantId });
  const [selectedSessionId, setSelectedSessionId] = useState<Id<"openPlaySessions"> | null>(null);
  const currentSessionId = selectedSessionId ?? sessions?.[0]?._id ?? null;

  const session = useQuery(
    api.openPlaySessions.getById,
    currentSessionId ? { sessionId: currentSessionId } : "skip",
  );
  const sessionPlayers = useQuery(
    api.openPlaySessions.getSessionPlayers,
    currentSessionId ? { sessionId: currentSessionId } : "skip",
  );
  const liveMatches = useQuery(
    api.openPlaySessions.getLiveMatches,
    currentSessionId ? { sessionId: currentSessionId } : "skip",
  );
  const matchHistory = useQuery(
    api.openPlaySessions.getMatchHistory,
    currentSessionId ? { sessionId: currentSessionId } : "skip",
  );

  const createSession = useMutation(api.openPlaySessions.createSession);
  const updateSessionStatus = useMutation(api.openPlaySessions.updateSessionStatus);
  const updateSessionMatchingMode = useMutation(api.openPlaySessions.updateSessionMatchingMode);
  const checkInPlayer = useMutation(api.openPlaySessions.checkInPlayer);
  const registerGuest = useMutation(api.openPlaySessions.registerAndCheckInGuest);
  const generateMatches = useMutation(api.openPlaySessions.generateMatches);
  const [isPending, startTransition] = useTransition();

  const sortedPlayers = useMemo(
    () =>
      [...(players ?? [])].sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      ),
    [players],
  );
  const sortedSessionPlayers = useMemo(
    () => sortSessionPlayers((sessionPlayers ?? []) as SessionPlayerRow[]),
    [sessionPlayers],
  );
  const queuedCount = sortedSessionPlayers.filter((player) => player.status === "queued").length;
  const playingCount = sortedSessionPlayers.filter((player) => player.status === "playing").length;
  const activeMatches = ((liveMatches ?? []) as LiveMatch[]).filter((match) => ACTIVE_STATUSES.has(match.status));
  const completedCount = matchHistory?.length ?? 0;
  const livePath = currentSessionId ? `/${tenantSlug}/open-play/${currentSessionId}` : null;

  const [newSession, setNewSession] = useState({
    name: "Open Play",
    date: "",
    matchingMode: "auto_balanced" as MatchingMode,
  });
  const [checkInPlayerId, setCheckInPlayerId] = useState<string>("");
  const [guest, setGuest] = useState({
    firstName: "",
    lastName: "",
    skillTier: "Low Intermediate" as (typeof SKILL_TIERS)[number],
    gender: "",
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setNewSession((current) => ({
        ...current,
        date: toDatetimeLocalValue(),
      }));
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  function submitNewSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = parseSessionDateInput(newSession.date);
    if (date === null) {
      toast.error("Enter a valid session date.");
      return;
    }

    startTransition(async () => {
      const result = await createSession({
        tenantId,
        name: newSession.name,
        date,
        matchingMode: newSession.matchingMode,
      });

      if (typeof result === "string") {
        setSelectedSessionId(result as Id<"openPlaySessions">);
        toast.success("Open play session created.");
      } else {
        toast.error(result.error ?? "Could not create session.");
      }
    });
  }

  function submitStatus(status: SessionStatus) {
    if (!currentSessionId) return;
    startTransition(async () => {
      const result = await updateSessionStatus({ sessionId: currentSessionId, status });
      if (result.success) {
        toast.success(`Status set to ${formatSessionStatus(status)}.`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitMatchingMode(mode: MatchingMode) {
    if (!currentSessionId) return;
    startTransition(async () => {
      const result = await updateSessionMatchingMode({ sessionId: currentSessionId, matchingMode: mode });
      if (result.success) {
        toast.success("Matching mode updated.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentSessionId || !checkInPlayerId) return;
    startTransition(async () => {
      const result = await checkInPlayer({
        sessionId: currentSessionId,
        playerId: checkInPlayerId as Id<"players">,
      });
      if (result.success) {
        setCheckInPlayerId("");
        toast.success("Player checked in.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentSessionId) return;
    startTransition(async () => {
      const result = await registerGuest({
        tenantId,
        sessionId: currentSessionId,
        firstName: guest.firstName,
        lastName: guest.lastName,
        skillTier: guest.skillTier,
        gender: guest.gender.trim() || undefined,
      });
      if (result.success) {
        setGuest((current) => ({ ...current, firstName: "", lastName: "", gender: "" }));
        toast.success("Walk-in checked in.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitGenerateMatches() {
    if (!currentSessionId) return;
    startTransition(async () => {
      const result = await generateMatches({ sessionId: currentSessionId });
      if (result.success) {
        toast.success(result.message ?? "Matches generated.");
      } else {
        toast.error(result.error);
      }
    });
  }

  async function copyLiveLink() {
    if (!livePath || typeof window === "undefined") return;
    if (!navigator.clipboard) {
      toast.error("Clipboard is unavailable.");
      return;
    }

    try {
      await navigator.clipboard.writeText(`${window.location.origin}${livePath}`);
      toast.success("Live link copied.");
    } catch {
      toast.error("Could not copy live link.");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{tenantName}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Open Play Control</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/${tenantSlug}/admin/dashboard`}>Tournament dashboard</Link>
            </Button>
            {livePath ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={copyLiveLink}>
                  <Copy />
                  Copy live link
                </Button>
                <Button asChild size="sm" className="bg-[var(--tenant-primary)]">
                  <Link href={livePath}>
                    <ExternalLink />
                    Player view
                  </Link>
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>New Session</CardTitle>
              <CardDescription>Queue, courts, results.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={submitNewSession}>
                <Input
                  value={newSession.name}
                  onChange={(event) => setNewSession((current) => ({ ...current, name: event.target.value }))}
                  aria-label="Session name"
                />
                <Input
                  type="datetime-local"
                  value={newSession.date}
                  onChange={(event) => setNewSession((current) => ({ ...current, date: event.target.value }))}
                  aria-label="Session date"
                />
                <Select
                  value={newSession.matchingMode}
                  onValueChange={(value) =>
                    setNewSession((current) => ({ ...current, matchingMode: value as MatchingMode }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATCHING_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={isPending} className="w-full bg-[var(--tenant-primary)]">
                  <Plus />
                  Create session
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
              <CardDescription>{sessions ? `${sessions.length} recent` : "Loading"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(sessions ?? []).map((item) => (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => setSelectedSessionId(item._id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition hover:bg-accent ${
                    currentSessionId === item._id ? "border-[var(--tenant-primary)] bg-accent" : "border-border"
                  }`}
                >
                  <span className="block text-sm font-medium">{item.name}</span>
                  <span className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatSessionStatus(item.status)}</span>
                    <span>{formatMatchingMode(item.matchingMode)}</span>
                  </span>
                </button>
              ))}
              {sessions?.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No sessions yet.</div>
              ) : null}
            </CardContent>
          </Card>
        </aside>

        <section className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric icon={<Radio />} label="Status" value={session ? formatSessionStatus(session.status) : "Loading"} />
            <Metric icon={<Clock3 />} label="Queued" value={String(queuedCount)} />
            <Metric icon={<Activity />} label="Playing" value={String(playingCount)} />
            <Metric icon={<CheckCircle2 />} label="Results" value={String(completedCount)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{session?.name ?? "Select a session"}</CardTitle>
              <CardDescription>
                {session ? `${formatMatchingMode(session.matchingMode)} rotation` : "Open play control surface"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[1fr_260px]">
              <div className="flex flex-wrap gap-2">
                {SESSION_STATUSES.map((status) => (
                  <Button
                    key={status.value}
                    type="button"
                    variant={session?.status === status.value ? "default" : "outline"}
                    size="sm"
                    disabled={!currentSessionId || isPending}
                    onClick={() => submitStatus(status.value)}
                    className={session?.status === status.value ? "bg-[var(--tenant-primary)]" : ""}
                  >
                    {status.label}
                  </Button>
                ))}
              </div>
              <Select
                value={session?.matchingMode}
                disabled={!currentSessionId || !session}
                onValueChange={(value) => submitMatchingMode(value as MatchingMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Matching mode" />
                </SelectTrigger>
                <SelectContent>
                  {MATCHING_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Courts</CardTitle>
                  <CardDescription>{activeMatches.length} active matches</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    type="button"
                    disabled={!currentSessionId || session?.status !== "live" || queuedCount < 4 || isPending}
                    onClick={submitGenerateMatches}
                    className="bg-[var(--tenant-primary)]"
                  >
                    <Play />
                    Generate matches
                  </Button>
                  <div className="grid gap-3 md:grid-cols-2">
                    {activeMatches.map((match) => (
                      <MatchScoreCard key={match._id} match={match} />
                    ))}
                    {activeMatches.length === 0 ? (
                      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                        No active courts.
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recent Results</CardTitle>
                  <CardDescription>{completedCount} completed matches</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {((matchHistory ?? []) as LiveMatch[]).slice(0, 8).map((match) => (
                    <div key={match._id} className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[1fr_auto_1fr]">
                      <span>{teamName(match.team1Details)}</span>
                      <span className="font-semibold">
                        {match.score1} - {match.score2}
                      </span>
                      <span className="md:text-right">{teamName(match.team2Details)}</span>
                    </div>
                  ))}
                  {completedCount === 0 ? (
                    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                      No completed results.
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Check-in</CardTitle>
                  <CardDescription>{sortedPlayers.length} directory players</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form className="flex gap-2" onSubmit={submitCheckIn}>
                    <Select value={checkInPlayerId} onValueChange={setCheckInPlayerId}>
                      <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue placeholder="Directory player" />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedPlayers.map((player) => (
                          <SelectItem key={player._id} value={player._id}>
                            {player.firstName} {player.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="submit" disabled={!currentSessionId || !checkInPlayerId || isPending} size="icon">
                      <UserPlus />
                    </Button>
                  </form>

                  <form className="grid gap-2" onSubmit={submitGuest}>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={guest.firstName}
                        onChange={(event) => setGuest((current) => ({ ...current, firstName: event.target.value }))}
                        placeholder="First"
                        aria-label="Walk-in first name"
                      />
                      <Input
                        value={guest.lastName}
                        onChange={(event) => setGuest((current) => ({ ...current, lastName: event.target.value }))}
                        placeholder="Last"
                        aria-label="Walk-in last name"
                      />
                    </div>
                    <div className="grid grid-cols-[1fr_120px] gap-2">
                      <Select
                        value={guest.skillTier}
                        onValueChange={(value) =>
                          setGuest((current) => ({ ...current, skillTier: value as (typeof SKILL_TIERS)[number] }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SKILL_TIERS.map((tier) => (
                            <SelectItem key={tier} value={tier}>
                              {tier}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={guest.gender}
                        onChange={(event) => setGuest((current) => ({ ...current, gender: event.target.value }))}
                        placeholder="Gender"
                        aria-label="Walk-in gender"
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={!currentSessionId || !guest.firstName || !guest.lastName || isPending}
                    >
                      <Plus />
                      Add walk-in
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Queue</CardTitle>
                  <CardDescription>{sortedSessionPlayers.length} checked in</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {sortedSessionPlayers.map((player) => (
                    <div
                      key={player._id}
                      className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{playerName(player.playerDetails)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {player.playerDetails?.manualSkillLevel ?? "Unrated"}
                        </p>
                      </div>
                      <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize text-muted-foreground">
                        {player.status.replace("_", " ")}
                      </span>
                    </div>
                  ))}
                  {sortedSessionPlayers.length === 0 ? (
                    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                      No players checked in.
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-[var(--tenant-primary)] text-primary-foreground">
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MatchScoreCard({ match }: { match: LiveMatch }) {
  const recordMatchScore = useMutation(api.openPlaySessions.recordMatchScore);
  const [score1, setScore1] = useState("");
  const [score2, setScore2] = useState("");
  const [isPending, startTransition] = useTransition();
  const parsedScore1 = parseScoreInput(score1);
  const parsedScore2 = parseScoreInput(score2);
  const canRecordScore = parsedScore1 !== null && parsedScore2 !== null && parsedScore1 !== parsedScore2;

  function submitScore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsedScore1 === null || parsedScore2 === null) {
      toast.error("Enter whole-number scores.");
      return;
    }
    if (parsedScore1 === parsedScore2) {
      toast.error("Scores cannot be tied.");
      return;
    }

    startTransition(async () => {
      const result = await recordMatchScore({
        matchId: match._id,
        score1: parsedScore1,
        score2: parsedScore2,
      });
      if (result.success) {
        setScore1("");
        setScore2("");
        toast.success("Score recorded.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-semibold">{match.courtName ?? "Court"}</p>
        <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize text-muted-foreground">
          {match.status.replace("_", " ")}
        </span>
      </div>
      <div className="space-y-2 text-sm">
        <p>{teamName(match.team1Details)}</p>
        <p>{teamName(match.team2Details)}</p>
      </div>
      <form className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={submitScore}>
        <Input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={score1}
          onChange={(event) => setScore1(event.target.value)}
          aria-label="Team 1 score"
        />
        <Input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={score2}
          onChange={(event) => setScore2(event.target.value)}
          aria-label="Team 2 score"
        />
        <Button type="submit" size="icon" disabled={!canRecordScore || isPending}>
          <RotateCw />
        </Button>
      </form>
    </div>
  );
}
