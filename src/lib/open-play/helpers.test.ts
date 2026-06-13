import { describe, expect, test } from "vitest";
import {
  arePlayersOnSameMatchTeam,
  buildLiveSessionUrl,
  buildSessionLeaderboard,
  canCancelMatchAdjustment,
  canSubstituteMatchPlayer,
  canSwapMatchPlayers,
  formatMatchingMode,
  formatQueueLabel,
  formatRotationStats,
  formatSessionStatus,
  getActivePlayerIds,
  getEligibleSubstitutes,
  isMatchScored,
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

  test("sorts sitting-out players by rotation priority", () => {
    const sorted = sortSessionPlayers([
      {
        status: "sitting_out",
        checkedInAt: 1,
        consecutiveSitOuts: 1,
        sitOutCount: 3,
        lastPlayedAt: 100,
        playerDetails: { firstName: "One", lastName: "Sit" },
      },
      {
        status: "sitting_out",
        checkedInAt: 2,
        consecutiveSitOuts: 2,
        sitOutCount: 2,
        lastPlayedAt: 200,
        playerDetails: { firstName: "Two", lastName: "Sit" },
      },
      {
        status: "queued",
        queuePosition: 1,
        checkedInAt: 3,
        playerDetails: { firstName: "Queued", lastName: "Player" },
      },
    ]);

    expect(sorted.map((player) => player.playerDetails?.firstName)).toEqual(["Two", "One", "Queued"]);
  });

  test("parses session dates and scores before mutations", () => {
    expect(parseSessionDateInput("2026-06-01T19:30")).toEqual(expect.any(Number));
    expect(parseSessionDateInput("not-a-date")).toBeNull();
    expect(parseScoreInput("11")).toBe(11);
    expect(parseScoreInput(" 0 ")).toBe(0);
    expect(parseScoreInput("-1")).toBeNull();
    expect(parseScoreInput("11.5")).toBeNull();
    expect(parseScoreInput("Infinity")).toBeNull();
    expect(parseScoreInput("")).toBeNull();
    expect(parseScoreInput("   ")).toBeNull();
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

  // --- New helper tests ---

  test("buildLiveSessionUrl constructs the expected URL", () => {
    expect(buildLiveSessionUrl("https://app.example.com", "test-club", "abc123")).toBe(
      "https://app.example.com/test-club/open-play/abc123"
    );
  });

  test("buildLiveSessionUrl strips trailing slash from origin", () => {
    expect(buildLiveSessionUrl("https://app.example.com/", "my-club", "sess1")).toBe(
      "https://app.example.com/my-club/open-play/sess1"
    );
  });

  test("buildLiveSessionUrl normalizes tenant and path slashes", () => {
    expect(buildLiveSessionUrl("https://app.example.com///", "/my-club/", "/sess1/")).toBe(
      "https://app.example.com/my-club/open-play/sess1"
    );
  });

  test("formatQueueLabel returns rank label for queued players", () => {
    expect(formatQueueLabel({ status: "queued", checkedInAt: 0 }, 1)).toBe("#1 in queue");
    expect(formatQueueLabel({ status: "queued", checkedInAt: 0 }, 3)).toBe("#3 in queue");
    expect(formatQueueLabel({ status: "queued", checkedInAt: 0 })).toBe("In queue");
  });

  test("formatQueueLabel returns correct labels for all non-queued statuses", () => {
    expect(formatQueueLabel({ status: "sitting_out", checkedInAt: 0 })).toBe("Sitting out - priority next");
    expect(formatQueueLabel({ status: "paused", checkedInAt: 0 })).toBe("Paused");
    expect(formatQueueLabel({ status: "playing", checkedInAt: 0 })).toBe("Playing");
    expect(formatQueueLabel({ status: "left", checkedInAt: 0 })).toBe("Left");
    expect(formatQueueLabel({ status: "checked_in", checkedInAt: 0 })).toBe("Checked in");
    expect(formatQueueLabel({ status: "warming_up", checkedInAt: 0 })).toBe("Waiting…");
  });

  test("formatRotationStats summarizes fairness metadata", () => {
    expect(formatRotationStats({ status: "queued", checkedInAt: 0 })).toBe("0 matches | 0 sit-outs");
    expect(
      formatRotationStats({
        status: "sitting_out",
        checkedInAt: 0,
        matchesPlayed: 1,
        sitOutCount: 2,
        consecutiveSitOuts: 2,
      })
    ).toBe("1 match | 2 sit-outs | 2 straight");
  });

  test("getActivePlayerIds collects all player IDs from active matches", () => {
    const ids = getActivePlayerIds([
      { team1: ["p1", "p2"], team2: ["p3", "p4"] },
      { team1: ["p5", "p6"], team2: ["p7", "p8"] },
    ]);

    expect(ids.size).toBe(8);
    expect(ids.has("p1")).toBe(true);
    expect(ids.has("p8")).toBe(true);
    expect(ids.has("p9")).toBe(false);
  });

  test("getActivePlayerIds returns empty set for no matches", () => {
    expect(getActivePlayerIds([])).toEqual(new Set());
  });

  test("teamName is stable for all-null or mixed null details", () => {
    expect(teamName([null, null])).toBe("TBD");
    expect(teamName([{ firstName: "Ada", lastName: "Lovelace" }, null])).toBe("Ada Lovelace");
  });

  test("guards match swaps to different players on different teams", () => {
    const match = {
      team1Details: [{ _id: "p1" }, { _id: "p2" }],
      team2Details: [{ _id: "p3" }, { _id: "p4" }],
    };

    expect(arePlayersOnSameMatchTeam(match, "p1", "p2")).toBe(true);
    expect(arePlayersOnSameMatchTeam(match, "p1", "p3")).toBe(false);
    expect(canSwapMatchPlayers(match, "p1", "p3")).toBe(true);
    expect(canSwapMatchPlayers(match, "p1", "p1")).toBe(false);
    expect(canSwapMatchPlayers(match, "p1", "p2")).toBe(false);
    expect(canSwapMatchPlayers(match, "p1", "not-in-match")).toBe(false);
  });

  test("guards substitutes and cancellations once a match is scored", () => {
    const unscoredMatch = {
      team1Details: [{ _id: "p1" }],
      team2Details: [{ _id: "p2" }],
      score1: null,
      score2: null,
    };
    const scoredMatch = {
      ...unscoredMatch,
      score1: 11,
    };

    expect(isMatchScored(unscoredMatch)).toBe(false);
    expect(isMatchScored(scoredMatch)).toBe(true);
    expect(canSubstituteMatchPlayer(unscoredMatch, "p1", "p5")).toBe(true);
    expect(canSubstituteMatchPlayer(unscoredMatch, "", "p5")).toBe(false);
    expect(canSubstituteMatchPlayer(scoredMatch, "p1", "p5")).toBe(false);
    expect(canCancelMatchAdjustment(unscoredMatch)).toBe(true);
    expect(canCancelMatchAdjustment(scoredMatch)).toBe(false);
  });

  test("filters eligible substitutes by queue status and active matches", () => {
    const activePlayerIds = new Set(["p4"]);
    const candidates = getEligibleSubstitutes(
      [
        { _id: "sp1", playerId: "p1", status: "queued", checkedInAt: 1 },
        { _id: "sp2", playerId: "p2", status: "sitting_out", checkedInAt: 2 },
        { _id: "sp3", playerId: "p3", status: "checked_in", checkedInAt: 3 },
        { _id: "sp4", playerId: "p4", status: "queued", checkedInAt: 4 },
      ],
      activePlayerIds
    );

    expect(candidates.map((candidate) => candidate.playerId)).toEqual(["p1", "p2"]);
  });
});
