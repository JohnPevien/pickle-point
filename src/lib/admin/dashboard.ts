export const DASHBOARD_SKILL_TIERS = [
  "Beginner",
  "Novice",
  "Low Intermediate",
  "High Intermediate",
  "Advanced",
] as const;

const BRACKET_LOCKED_STATUSES = new Set(["bracket_generated", "live"]);

export type DashboardTeamRow = {
  skillTier: string;
};

export function groupDashboardTeamsByTier<T extends DashboardTeamRow>(teams: T[]) {
  return teams.reduce<Partial<Record<string, T[]>>>((acc, team) => {
    const existing = acc[team.skillTier];
    if (existing) {
      existing.push(team);
    } else {
      acc[team.skillTier] = [team];
    }
    return acc;
  }, {});
}

export function isDashboardBracketLocked(status: string | undefined) {
  return status !== undefined && BRACKET_LOCKED_STATUSES.has(status);
}

export function canGenerateDashboardBracket(status: string | undefined, teamCount: number) {
  return teamCount >= 2 && !isDashboardBracketLocked(status);
}

export function dashboardBracketActionLabel(status: string | undefined, isPending: boolean) {
  if (isPending) return "Processing...";
  if (isDashboardBracketLocked(status)) return "Bracket Locked";
  return "Generate Bracket";
}

export function formatDashboardStatus(status: string | undefined) {
  return status?.replaceAll("_", " ") ?? "";
}
