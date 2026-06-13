export const PLAYER_SKILL_LEVELS = [
  "Beginner",
  "Novice",
  "Low Intermediate",
  "High Intermediate",
  "Advanced",
] as const;

export type PlayerSkillLevel = (typeof PLAYER_SKILL_LEVELS)[number];
export type PlayerSkillSource = "manual" | "dupr";
export type DuprPresenceFilter = "all" | "with" | "without";

export type PlayerDirectoryFilters = {
  search: string;
  skillSource: "all" | PlayerSkillSource;
  manualSkillLevel: "all" | PlayerSkillLevel;
  duprPresence: DuprPresenceFilter;
};

export type PlayerDirectoryRow = {
  firstName: string;
  lastName: string;
  skillSource: PlayerSkillSource;
  manualSkillLevel: PlayerSkillLevel;
  duprRating?: number;
  username?: string;
  email?: string;
  phone?: string;
};

export function playerDisplayName(player: Pick<PlayerDirectoryRow, "firstName" | "lastName">) {
  return `${player.firstName} ${player.lastName}`.trim();
}

export function sortPlayersByName<T extends Pick<PlayerDirectoryRow, "firstName" | "lastName">>(players: T[]) {
  return [...players].sort((a, b) => playerDisplayName(a).localeCompare(playerDisplayName(b)));
}

export function filterPlayers<T extends PlayerDirectoryRow>(players: T[], filters: PlayerDirectoryFilters) {
  const query = filters.search.trim().toLowerCase();

  return players.filter((player) => {
    if (query) {
      const haystack = [
        playerDisplayName(player),
        player.username,
        player.email,
        player.phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (filters.skillSource !== "all" && player.skillSource !== filters.skillSource) {
      return false;
    }

    if (filters.manualSkillLevel !== "all" && player.manualSkillLevel !== filters.manualSkillLevel) {
      return false;
    }

    if (filters.duprPresence === "with" && player.duprRating === undefined) {
      return false;
    }

    if (filters.duprPresence === "without" && player.duprRating !== undefined) {
      return false;
    }

    return true;
  });
}
