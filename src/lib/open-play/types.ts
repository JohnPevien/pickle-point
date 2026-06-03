import type { Doc } from "../../../convex/_generated/dataModel";

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
