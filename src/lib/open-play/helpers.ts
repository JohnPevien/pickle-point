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
    if (a.status === "queued" && b.status === "queued") {
      return (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER);
    }
    if (a.status === "queued") return -1;
    if (b.status === "queued") return 1;
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
  sitting_out: "Sitting out",
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

type ActiveMatchLike = {
  team1: string[];
  team2: string[];
};

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
