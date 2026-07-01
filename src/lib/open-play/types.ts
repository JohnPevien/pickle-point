import type { Doc, Id } from "../../../convex/_generated/dataModel";

/**
 * Shared shape aliases for open-play views (admin control + live display).
 * Centralised so MatchAdjustPanel, OpenPlayControlView, and LiveOpenPlayView
 * stay in sync when the underlying Convex document shape changes.
 */

export type PlayerDetails = Pick<
  Doc<"players">,
  "_id" | "firstName" | "lastName" | "manualSkillLevel"
> | null;

export type SessionPlayerRow = Doc<"sessionPlayers"> & {
  playerDetails: PlayerDetails;
};

export type LiveMatch = Doc<"sessionMatches"> & {
  team1Details: PlayerDetails[];
  team2Details: PlayerDetails[];
};

export type PublicPlayerDetails = {
  firstName: string;
  lastName: string;
  manualSkillLevel?: string | null;
  profileImageUrl?: string | null;
  rating?: number | null;
};

/**
 * Public session-player projection. Carries only the rotation/queue
 * fields the public live view needs to sort the queue, render queue
 * labels, and display rotation stats. Private player fields (email,
 * phone, notes, username) live on `PlayerDetails` (admin) only.
 */
export type PublicSessionPlayerRow = {
  _id: Id<"sessionPlayers">;
  status: Doc<"sessionPlayers">["status"];
  queuePosition?: number;
  checkedInAt: number;
  matchesPlayed?: number;
  sitOutCount?: number;
  consecutiveSitOuts?: number;
  lastPlayedAt?: number;
  lastSatOutAt?: number;
  playerDetails: PublicPlayerDetails;
};

export type PublicLiveMatch = {
  _id: Id<"sessionMatches">;
  courtName?: string | null;
  status: Doc<"sessionMatches">["status"];
  score1?: number | null;
  score2?: number | null;
  team1Details: PublicPlayerDetails[];
  team2Details: PublicPlayerDetails[];
};
