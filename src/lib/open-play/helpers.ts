import { buildTenantUrl } from "@/lib/url";

export const SKILL_TIERS = [
  "Beginner",
  "Novice",
  "Low Intermediate",
  "High Intermediate",
  "Advanced",
] as const;

export const MATCHING_MODES = [
  { value: "auto_balanced", label: "Auto-balanced" },
  { value: "skill_separated", label: "Skill-separated" },
  { value: "winners_vs_losers", label: "Winners vs losers" },
  { value: "mixed_doubles", label: "Mixed doubles" },
  { value: "skill_courts", label: "Skill courts" },
] as const;

export const SESSION_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "check_in", label: "Check-in" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export type SkillTier = (typeof SKILL_TIERS)[number];
export type MatchingMode = (typeof MATCHING_MODES)[number]["value"];
export type SessionStatus = (typeof SESSION_STATUSES)[number]["value"];

type NamedPlayer = {
  _id?: string;
  firstName?: string;
  lastName?: string;
} | null;

type SessionPlayerLike = {
  status: string;
  queuePosition?: number;
  checkedInAt: number;
  matchesPlayed?: number;
  sitOutCount?: number;
  consecutiveSitOuts?: number;
  lastPlayedAt?: number;
  lastSatOutAt?: number;
  playerDetails?: NamedPlayer;
};

type CompletedMatchLike = {
  team1Details?: NamedPlayer[];
  team2Details?: NamedPlayer[];
  score1?: number;
  score2?: number;
};

export type PlayerStanding = {
  id: string;
  name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
};

const statusLabels = new Map(SESSION_STATUSES.map((status) => [status.value, status.label]));
const matchingModeLabels = new Map(MATCHING_MODES.map((mode) => [mode.value, mode.label]));

export function formatSessionStatus(status: string) {
  return statusLabels.get(status as SessionStatus) ?? titleize(status);
}

export function formatMatchingMode(mode: string) {
  return matchingModeLabels.get(mode as MatchingMode) ?? titleize(mode);
}

export function playerName(player: NamedPlayer) {
  if (!player) return "Unknown player";
  const name = [player.firstName, player.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return name || "Unknown player";
}

export function teamName(players: NamedPlayer[] | undefined) {
  const names = (players ?? []).map(playerName).filter((name) => name !== "Unknown player");
  return names.length > 0 ? names.join(" / ") : "TBD";
}

export function sortSessionPlayers<T extends SessionPlayerLike>(players: T[]) {
  return [...players].sort((a, b) => {
    const aStatusRank = sessionPlayerStatusRank(a.status);
    const bStatusRank = sessionPlayerStatusRank(b.status);
    if (aStatusRank !== bStatusRank) return aStatusRank - bStatusRank;

    if (a.status === "queued" && b.status === "queued") {
      return (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER);
    }
    if (a.status === "sitting_out" && b.status === "sitting_out") {
      const consecutiveDiff = (b.consecutiveSitOuts ?? 0) - (a.consecutiveSitOuts ?? 0);
      if (consecutiveDiff !== 0) return consecutiveDiff;
      const sitOutDiff = (b.sitOutCount ?? 0) - (a.sitOutCount ?? 0);
      if (sitOutDiff !== 0) return sitOutDiff;
      const aLastPlayed = a.lastPlayedAt ?? Number.NEGATIVE_INFINITY;
      const bLastPlayed = b.lastPlayedAt ?? Number.NEGATIVE_INFINITY;
      if (aLastPlayed !== bLastPlayed) return aLastPlayed - bLastPlayed;
    }
    return a.checkedInAt - b.checkedInAt;
  });
}

export function parseSessionDateInput(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function parseScoreInput(value: string) {
  if (!value.trim()) return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || !Number.isInteger(score)) {
    return null;
  }
  return score;
}

export function buildSessionLeaderboard(matches: CompletedMatchLike[]) {
  const standings = new Map<string, PlayerStanding>();

  const ensureStanding = (player: NamedPlayer) => {
    if (!player) return null;
    const name = playerName(player);
    if (name === "Unknown player" && !player._id) return null;

    const id = player?._id ?? name;
    const existing = standings.get(id);
    if (existing) return existing;

    const next = {
      id,
      name,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
    };
    standings.set(id, next);
    return next;
  };

  for (const match of matches) {
    if (typeof match.score1 !== "number" || typeof match.score2 !== "number") continue;
    const team1Won = match.score1 > match.score2;

    for (const player of match.team1Details ?? []) {
      const standing = ensureStanding(player);
      if (!standing) continue;
      standing.wins += team1Won ? 1 : 0;
      standing.losses += team1Won ? 0 : 1;
      standing.pointsFor += match.score1;
      standing.pointsAgainst += match.score2;
    }

    for (const player of match.team2Details ?? []) {
      const standing = ensureStanding(player);
      if (!standing) continue;
      standing.wins += team1Won ? 0 : 1;
      standing.losses += team1Won ? 1 : 0;
      standing.pointsFor += match.score2;
      standing.pointsAgainst += match.score1;
    }
  }

  return [...standings.values()]
    .map((standing) => ({
      ...standing,
      pointDiff: standing.pointsFor - standing.pointsAgainst,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      return a.name.localeCompare(b.name);
    });
}

export function toDatetimeLocalValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function titleize(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sessionPlayerStatusRank(status: string) {
  switch (status) {
    case "sitting_out":
      return 0;
    case "queued":
      return 1;
    case "paused":
      return 2;
    case "playing":
      return 3;
    case "checked_in":
      return 4;
    case "left":
      return 5;
    default:
      return 6;
  }
}

/**
 * Builds the public live session URL for a tenant/session.
 * Pure function — does not depend on window or browser APIs.
 */
export function buildLiveSessionUrl(
  origin: string,
  tenantSlug: string,
  sessionId: string
): string {
  return buildTenantUrl(origin, tenantSlug, "open-play", sessionId);
}

const QUEUE_STATUS_LABELS: Record<string, string> = {
  sitting_out: "Sitting out - priority next",
  paused: "Paused",
  playing: "Playing",
  left: "Left",
  checked_in: "Checked in",
};

/**
 * Returns a human-readable queue state label for a session player.
 * The optional rank is the 1-based ordinal position among queued players.
 */
export function formatQueueLabel(
  player: SessionPlayerLike,
  rank?: number
): string {
  if (player.status === "queued") {
    return rank != null ? `#${rank} in queue` : "In queue";
  }
  return QUEUE_STATUS_LABELS[player.status] ?? "Waiting…";
}

export function formatRotationStats(player: SessionPlayerLike): string {
  const matchesPlayed = player.matchesPlayed ?? 0;
  const sitOutCount = player.sitOutCount ?? 0;
  const consecutiveSitOuts = player.consecutiveSitOuts ?? 0;
  const stats = [
    `${matchesPlayed} ${matchesPlayed === 1 ? "match" : "matches"}`,
    `${sitOutCount} ${sitOutCount === 1 ? "sit-out" : "sit-outs"}`,
  ];

  if (consecutiveSitOuts > 0) {
    stats.push(`${consecutiveSitOuts} straight`);
  }

  return stats.join(" | ");
}

type ActiveMatchLike = {
  team1: string[];
  team2: string[];
};

type MatchAdjustmentPlayerLike = {
  _id?: string;
} | null;

type MatchAdjustmentMatchLike = {
  team1Details: MatchAdjustmentPlayerLike[];
  team2Details: MatchAdjustmentPlayerLike[];
  score1?: number | null;
  score2?: number | null;
};

type SubstituteCandidateLike = SessionPlayerLike & {
  playerId: string;
};

type MatchTeam = "team1" | "team2";

export const AVAILABLE_STATUSES = new Set(["queued", "sitting_out"]);

export function isAvailablePlayer(player: SessionPlayerLike): boolean {
  return AVAILABLE_STATUSES.has(player.status);
}

/**
 * Collects the set of player IDs currently in active (pending/in_progress) matches.
 * Useful for validating substitute candidates on the UI side.
 */
export function getActivePlayerIds(matches: ActiveMatchLike[]): Set<string> {
  const ids = new Set<string>();
  for (const match of matches) {
    for (const id of match.team1) ids.add(id);
    for (const id of match.team2) ids.add(id);
  }
  return ids;
}

function matchPlayerTeam(match: MatchAdjustmentMatchLike, playerId: string): MatchTeam | null {
  if (match.team1Details.some((player) => player?._id === playerId)) return "team1";
  if (match.team2Details.some((player) => player?._id === playerId)) return "team2";
  return null;
}

export function arePlayersOnSameMatchTeam(
  match: MatchAdjustmentMatchLike,
  playerAId: string,
  playerBId: string
): boolean {
  if (!playerAId || !playerBId || playerAId === playerBId) return false;

  const playerATeam = matchPlayerTeam(match, playerAId);
  const playerBTeam = matchPlayerTeam(match, playerBId);

  return playerATeam !== null && playerATeam === playerBTeam;
}

export function canSwapMatchPlayers(
  match: MatchAdjustmentMatchLike,
  playerAId: string,
  playerBId: string
): boolean {
  if (!playerAId || !playerBId || playerAId === playerBId) return false;

  const playerATeam = matchPlayerTeam(match, playerAId);
  const playerBTeam = matchPlayerTeam(match, playerBId);

  return playerATeam !== null && playerBTeam !== null && playerATeam !== playerBTeam;
}

export function isMatchScored(match: MatchAdjustmentMatchLike): boolean {
  return match.score1 != null || match.score2 != null;
}

export function getEligibleSubstitutes<T extends SubstituteCandidateLike>(
  sessionPlayers: T[],
  activePlayerIds: Set<string>
): T[] {
  return sessionPlayers.filter(
    (player) => isAvailablePlayer(player) && !activePlayerIds.has(player.playerId)
  );
}

export function canSubstituteMatchPlayer(
  match: MatchAdjustmentMatchLike,
  outgoingPlayerId: string,
  incomingPlayerId: string
): boolean {
  return !isMatchScored(match) && Boolean(outgoingPlayerId && incomingPlayerId);
}

export function canCancelMatchAdjustment(match: MatchAdjustmentMatchLike): boolean {
  return !isMatchScored(match);
}
