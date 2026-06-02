import { describe, expect, test } from "vitest";
import {
  buildSessionLeaderboard,
  formatMatchingMode,
  formatSessionStatus,
  parseScoreInput,
  parseSessionDateInput,
  playerName,
  sortSessionPlayers,
  teamName,
} from "./helpers";

describe("open play helpers", () => {
  test("formats known and fallback labels", () => {
    expect(formatSessionStatus("check_in")).toBe("Check-in");
    expect(formatSessionStatus("custom_status")).toBe("Custom Status");
    expect(formatMatchingMode("auto_balanced")).toBe("Auto-balanced");
  });

  test("formats player and team names defensively", () => {
    expect(playerName({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(playerName(null)).toBe("Unknown player");
    expect(teamName([{ firstName: "Ada", lastName: "Lovelace" }, { firstName: "Grace", lastName: "Hopper" }])).toBe(
      "Ada Lovelace / Grace Hopper",
    );
    expect(teamName([])).toBe("TBD");
  });

  test("sorts queue players before non-queued players by position", () => {
    const sorted = sortSessionPlayers([
      { status: "playing", checkedInAt: 3, playerDetails: { firstName: "In", lastName: "Game" } },
      { status: "queued", queuePosition: 2, checkedInAt: 2, playerDetails: { firstName: "Second", lastName: "Queue" } },
      { status: "queued", queuePosition: 1, checkedInAt: 1, playerDetails: { firstName: "First", lastName: "Queue" } },
    ]);

    expect(sorted.map((player) => player.playerDetails?.firstName)).toEqual(["First", "Second", "In"]);
  });

  test("parses session dates and scores before mutations", () => {
    expect(parseSessionDateInput("2026-06-01T19:30")).toEqual(expect.any(Number));
    expect(parseSessionDateInput("not-a-date")).toBeNull();
    expect(parseScoreInput("11")).toBe(11);
    expect(parseScoreInput("-1")).toBeNull();
    expect(parseScoreInput("11.5")).toBeNull();
    expect(parseScoreInput("")).toBeNull();
  });

  test("builds a session leaderboard from completed matches", () => {
    const leaderboard = buildSessionLeaderboard([
      {
        team1Details: [
          { _id: "p1", firstName: "Ada", lastName: "Lovelace" },
          { _id: "p2", firstName: "Grace", lastName: "Hopper" },
        ],
        team2Details: [
          { _id: "p3", firstName: "Katherine", lastName: "Johnson" },
          { _id: "p4", firstName: "Dorothy", lastName: "Vaughan" },
        ],
        score1: 11,
        score2: 8,
      },
    ]);

    expect(leaderboard).toHaveLength(4);
    expect(leaderboard[0]).toMatchObject({ name: "Ada Lovelace", wins: 1, pointDiff: 3 });
    expect(leaderboard[2]).toMatchObject({ name: "Dorothy Vaughan", losses: 1, pointDiff: -3 });
  });

  test("skips null and unidentifiable players in the session leaderboard", () => {
    const leaderboard = buildSessionLeaderboard([
      {
        team1Details: [null, { firstName: "", lastName: "" }],
        team2Details: [{ _id: "p2", firstName: "Grace", lastName: "Hopper" }],
        score1: 9,
        score2: 11,
      },
    ]);

    expect(leaderboard).toEqual([
      {
        id: "p2",
        name: "Grace Hopper",
        wins: 1,
        losses: 0,
        pointsFor: 11,
        pointsAgainst: 9,
        pointDiff: 2,
      },
    ]);
  });
});
