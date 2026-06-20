import { describe, expect, test } from "vitest";
import {
  canGenerateDashboardBracket,
  dashboardBracketActionLabel,
  DASHBOARD_SKILL_TIERS,
  formatDashboardStatus,
  groupDashboardTeamsByTier,
  isDashboardBracketLocked,
} from "./dashboard";

describe("dashboard helpers", () => {
  const teams = [
    { id: "team1", skillTier: "Novice", name: "Dinks" },
    { id: "team2", skillTier: "Advanced", name: "Lobs" },
    { id: "team3", skillTier: "Novice", name: "Drops" },
  ];

  test("keeps the dashboard skill tiers in display order", () => {
    expect(DASHBOARD_SKILL_TIERS).toEqual([
      "Beginner",
      "Novice",
      "Low Intermediate",
      "High Intermediate",
      "Advanced",
    ]);
  });

  test("groups teams by skill tier without reordering teams inside each tier", () => {
    const grouped = groupDashboardTeamsByTier(teams);

    expect(grouped.Novice!.map((team) => team.name)).toEqual(["Dinks", "Drops"]);
    expect(grouped.Advanced!.map((team) => team.name)).toEqual(["Lobs"]);
    expect(grouped.Beginner).toBeUndefined();
  });

  test("locks bracket generation after bracket generation or live play starts", () => {
    expect(isDashboardBracketLocked("bracket_generated")).toBe(true);
    expect(isDashboardBracketLocked("live")).toBe(true);
    expect(isDashboardBracketLocked("registration_closed")).toBe(false);
  });

  test("requires enough teams and an unlocked tournament before generation", () => {
    expect(canGenerateDashboardBracket("registration_closed", 2)).toBe(true);
    expect(canGenerateDashboardBracket("registration_closed", 1)).toBe(false);
    expect(canGenerateDashboardBracket("live", 8)).toBe(false);
  });

  test("labels the bracket action from pending and status state", () => {
    expect(dashboardBracketActionLabel("registration_closed", true)).toBe("Processing...");
    expect(dashboardBracketActionLabel("bracket_generated", false)).toBe("Bracket Locked");
    expect(dashboardBracketActionLabel("registration_closed", false)).toBe("Generate Bracket");
  });

  test("formats dashboard statuses for display", () => {
    expect(formatDashboardStatus("registration_closed")).toBe("registration closed");
    expect(formatDashboardStatus(undefined)).toBe("");
  });
});
