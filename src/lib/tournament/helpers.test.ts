import { describe, test, expect } from "vitest";
import {
  statusLabel,
  formatLabel,
  stageLabel,
  formatTournamentDate,
  buildPublicTournamentUrl,
  parseScore,
  groupBracketByTierAndStage,
  computeRoundRobinStandings,
  matchEntrantLabel,
  isByeMatch,
  type MatchRow,
  type BracketRound,
} from "./helpers";

function makeMatch(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    _id: "match1",
    roundNumber: 1,
    matchOrder: 1,
    skillTier: "Novice",
    bracketStage: "single_elimination",
    entrant1Id: "e1",
    entrant2Id: "e2",
    entrant1Name: "Team A",
    entrant2Name: "Team B",
    winnerName: null,
    score1: null,
    score2: null,
    status: "pending",
    isIfNecessary: false,
    ...overrides,
  };
}

describe("statusLabel", () => {
  test("returns human-readable labels for all statuses", () => {
    expect(statusLabel("draft")).toBe("Draft");
    expect(statusLabel("registration_open")).toBe("Registration Open");
    expect(statusLabel("registration_closed")).toBe("Registration Closed");
    expect(statusLabel("bracket_generated")).toBe("Bracket Generated");
    expect(statusLabel("live")).toBe("Live");
    expect(statusLabel("completed")).toBe("Completed");
    expect(statusLabel("cancelled")).toBe("Cancelled");
  });
});

describe("formatLabel", () => {
  test("returns human-readable format names", () => {
    expect(formatLabel("single_elimination")).toBe("Single Elimination");
    expect(formatLabel("double_elimination")).toBe("Double Elimination");
    expect(formatLabel("round_robin")).toBe("Round Robin");
  });
});

describe("stageLabel", () => {
  test("returns human-readable stage labels", () => {
    expect(stageLabel("round_robin")).toBe("Round Robin");
    expect(stageLabel("single_elimination")).toBe("Bracket");
    expect(stageLabel("winners")).toBe("Winners Bracket");
    expect(stageLabel("losers")).toBe("Losers Bracket");
    expect(stageLabel("grand_final")).toBe("Grand Final");
  });
});

describe("formatTournamentDate", () => {
  test("formats a timestamp as a readable date string", () => {
    const ts = new Date("2026-06-15T12:00:00Z").getTime();
    const result = formatTournamentDate(ts);
    expect(result).toContain("2026");
    expect(result).toMatch(/Jun/i);
  });
});

describe("buildPublicTournamentUrl", () => {
  test("constructs the expected public tournament URL", () => {
    expect(buildPublicTournamentUrl("https://app.example.com", "test-club", "t123")).toBe(
      "https://app.example.com/test-club/tournaments/t123"
    );
  });

  test("strips trailing slashes from origin", () => {
    expect(buildPublicTournamentUrl("https://app.example.com///", "my-club", "t456")).toBe(
      "https://app.example.com/my-club/tournaments/t456"
    );
  });
});

describe("parseScore", () => {
  test("returns dash for null", () => {
    expect(parseScore(null)).toBe("-");
  });

  test("returns dash for undefined", () => {
    expect(parseScore(undefined)).toBe("-");
  });

  test("returns string for a number", () => {
    expect(parseScore(11)).toBe("11");
    expect(parseScore(0)).toBe("0");
  });
});

describe("matchEntrantLabel", () => {
  test("returns Bye when isBye is true", () => {
    expect(matchEntrantLabel("Team A", true)).toBe("Bye");
  });

  test("returns TBD when name is null and not a bye", () => {
    expect(matchEntrantLabel(null, false)).toBe("TBD");
  });

  test("returns the name when provided", () => {
    expect(matchEntrantLabel("Team Alpha", false)).toBe("Team Alpha");
  });
});

describe("isByeMatch", () => {
  test("returns true for a completed match with only one entrant", () => {
    const m = makeMatch({ status: "completed", entrant2Id: null, entrant2Name: null });
    expect(isByeMatch(m)).toBe(true);
  });

  test("returns false for a normal completed match", () => {
    const m = makeMatch({ status: "completed", score1: 11, score2: 7, winnerName: "Team A" });
    expect(isByeMatch(m)).toBe(false);
  });

  test("returns false for a pending match", () => {
    const m = makeMatch({ status: "pending", entrant2Id: null });
    expect(isByeMatch(m)).toBe(false);
  });
});

describe("groupBracketByTierAndStage", () => {
  test("groups matches by tier then stage then round", () => {
    const rounds: BracketRound[] = [
      {
        round: 1,
        matches: [
          makeMatch({ _id: "m1", skillTier: "Novice", bracketStage: "winners", roundNumber: 1 }),
          makeMatch({ _id: "m2", skillTier: "Beginner", bracketStage: "single_elimination", roundNumber: 1 }),
        ],
      },
      {
        round: 2,
        matches: [
          makeMatch({ _id: "m3", skillTier: "Novice", bracketStage: "winners", roundNumber: 2 }),
        ],
      },
    ];

    const grouped = groupBracketByTierAndStage(rounds);

    const beginnerGroup = grouped.find((g) => g.tier === "Beginner");
    const noviceGroup = grouped.find((g) => g.tier === "Novice");

    expect(beginnerGroup).toBeDefined();
    expect(noviceGroup).toBeDefined();

    expect(beginnerGroup!.stages).toHaveLength(1);
    expect(beginnerGroup!.stages[0].stage).toBe("single_elimination");
    expect(beginnerGroup!.stages[0].rounds).toHaveLength(1);

    expect(noviceGroup!.stages).toHaveLength(1);
    expect(noviceGroup!.stages[0].stage).toBe("winners");
    expect(noviceGroup!.stages[0].rounds).toHaveLength(2);
  });

  test("orders tiers by TIER_ORDER", () => {
    const rounds: BracketRound[] = [
      {
        round: 1,
        matches: [
          makeMatch({ _id: "mA", skillTier: "Advanced", bracketStage: "round_robin", roundNumber: 1 }),
          makeMatch({ _id: "mB", skillTier: "Beginner", bracketStage: "round_robin", roundNumber: 1 }),
        ],
      },
    ];

    const grouped = groupBracketByTierAndStage(rounds);
    expect(grouped[0].tier).toBe("Beginner");
    expect(grouped[1].tier).toBe("Advanced");
  });

  test("orders stages: winners before losers before grand_final", () => {
    const rounds: BracketRound[] = [
      {
        round: 1,
        matches: [
          makeMatch({ _id: "mGF", skillTier: "Novice", bracketStage: "grand_final", roundNumber: 1 }),
          makeMatch({ _id: "mL", skillTier: "Novice", bracketStage: "losers", roundNumber: 1 }),
          makeMatch({ _id: "mW", skillTier: "Novice", bracketStage: "winners", roundNumber: 1 }),
        ],
      },
    ];

    const grouped = groupBracketByTierAndStage(rounds);
    const stages = grouped[0].stages.map((s) => s.stage);
    expect(stages).toEqual(["winners", "losers", "grand_final"]);
  });
});

describe("computeRoundRobinStandings", () => {
  const teams = [
    { id: "e1", name: "Team Alpha" },
    { id: "e2", name: "Team Beta" },
    { id: "e3", name: "Team Gamma" },
  ];

  test("returns records sorted by wins descending", () => {
    const matches: MatchRow[] = [
      makeMatch({ _id: "r1", entrant1Id: "e1", entrant2Id: "e2", score1: 11, score2: 7, status: "completed", winnerName: "Team Alpha" }),
      makeMatch({ _id: "r2", entrant1Id: "e1", entrant2Id: "e3", score1: 11, score2: 5, status: "completed", winnerName: "Team Alpha" }),
      makeMatch({ _id: "r3", entrant1Id: "e2", entrant2Id: "e3", score1: 11, score2: 9, status: "completed", winnerName: "Team Beta" }),
    ];

    const standings = computeRoundRobinStandings(matches, teams);
    expect(standings[0].entrantId).toBe("e1");
    expect(standings[0].wins).toBe(2);
    expect(standings[1].entrantId).toBe("e2");
    expect(standings[1].wins).toBe(1);
    expect(standings[2].entrantId).toBe("e3");
    expect(standings[2].wins).toBe(0);
  });

  test("breaks win ties using point differential", () => {
    const matches: MatchRow[] = [
      makeMatch({ _id: "r1", entrant1Id: "e1", entrant2Id: "e3", score1: 11, score2: 1, status: "completed", winnerName: "Team Alpha" }),
      makeMatch({ _id: "r2", entrant1Id: "e2", entrant2Id: "e3", score1: 11, score2: 9, status: "completed", winnerName: "Team Beta" }),
    ];

    const standings = computeRoundRobinStandings(matches, teams);
    const e1 = standings.find((s) => s.entrantId === "e1")!;
    const e2 = standings.find((s) => s.entrantId === "e2")!;
    expect(e1.wins).toBe(1);
    expect(e2.wins).toBe(1);
    expect(e1.pointsFor - e1.pointsAgainst).toBeGreaterThan(
      e2.pointsFor - e2.pointsAgainst
    );
    expect(standings.indexOf(e1)).toBeLessThan(standings.indexOf(e2));
  });

  test("breaks remaining ties alphabetically by team name", () => {
    const tiedTeams = [
      { id: "e1", name: "Zebra Team" },
      { id: "e2", name: "Alpha Team" },
    ];
    const matches: MatchRow[] = [];
    const standings = computeRoundRobinStandings(matches, tiedTeams);
    expect(standings[0].entrantName).toBe("Alpha Team");
    expect(standings[1].entrantName).toBe("Zebra Team");
  });

  test("ignores incomplete matches", () => {
    const matches: MatchRow[] = [
      makeMatch({ _id: "r1", entrant1Id: "e1", entrant2Id: "e2", status: "pending" }),
    ];

    const standings = computeRoundRobinStandings(matches, teams);
    for (const s of standings) {
      expect(s.wins).toBe(0);
    }
  });
});
