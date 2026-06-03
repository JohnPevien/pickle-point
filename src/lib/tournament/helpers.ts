export type TournamentStatus =
  | "draft"
  | "registration_open"
  | "registration_closed"
  | "bracket_generated"
  | "live"
  | "completed"
  | "cancelled";

export type TournamentFormat =
  | "single_elimination"
  | "double_elimination"
  | "round_robin";

export type BracketStage =
  | "round_robin"
  | "single_elimination"
  | "winners"
  | "losers"
  | "grand_final";

export type SkillTier =
  | "Beginner"
  | "Novice"
  | "Low Intermediate"
  | "High Intermediate"
  | "Advanced";

export const TIER_ORDER: SkillTier[] = [
  "Beginner",
  "Novice",
  "Low Intermediate",
  "High Intermediate",
  "Advanced",
];

export function statusLabel(status: TournamentStatus): string {
  const labels: Record<TournamentStatus, string> = {
    draft: "Draft",
    registration_open: "Registration Open",
    registration_closed: "Registration Closed",
    bracket_generated: "Bracket Generated",
    live: "Live",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}

export function formatLabel(format: TournamentFormat): string {
  const labels: Record<TournamentFormat, string> = {
    single_elimination: "Single Elimination",
    double_elimination: "Double Elimination",
    round_robin: "Round Robin",
  };
  return labels[format] ?? format;
}

export function stageLabel(stage: BracketStage): string {
  const labels: Record<BracketStage, string> = {
    round_robin: "Round Robin",
    single_elimination: "Bracket",
    winners: "Winners Bracket",
    losers: "Losers Bracket",
    grand_final: "Grand Final",
  };
  return labels[stage] ?? stage;
}

export function formatTournamentDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function parseScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return String(value);
}

export type MatchRow = {
  _id: string;
  roundNumber: number;
  matchOrder: number;
  skillTier?: SkillTier | null;
  bracketStage?: BracketStage | null;
  entrant1Id?: string | null;
  entrant2Id?: string | null;
  entrant1Name: string | null;
  entrant2Name: string | null;
  winnerName: string | null;
  winnerId?: string | null;
  score1?: number | null;
  score2?: number | null;
  status: "pending" | "in_progress" | "completed";
  isIfNecessary?: boolean | null;
};

export type BracketRound = {
  round: number;
  matches: MatchRow[];
};

export type GroupedTierStage = {
  tier: SkillTier;
  stages: {
    stage: BracketStage;
    stageLabel: string;
    rounds: BracketRound[];
  }[];
};

export function groupBracketByTierAndStage(rounds: BracketRound[]): GroupedTierStage[] {
  const tierMap = new Map<SkillTier, Map<BracketStage, BracketRound[]>>();

  for (const round of rounds) {
    for (const match of round.matches) {
      const tier = (match.skillTier as SkillTier) ?? ("Novice" as SkillTier);
      const stage = (match.bracketStage as BracketStage) ?? ("single_elimination" as BracketStage);

      if (!tierMap.has(tier)) tierMap.set(tier, new Map());
      const stageMap = tierMap.get(tier)!;

      if (!stageMap.has(stage)) stageMap.set(stage, []);
      const existing = stageMap.get(stage)!;

      const existingRound = existing.find((r) => r.round === round.round);
      if (existingRound) {
        existingRound.matches.push(match);
      } else {
        existing.push({ round: round.round, matches: [match] });
      }
    }
  }

  const STAGE_ORDER: BracketStage[] = [
    "round_robin",
    "single_elimination",
    "winners",
    "losers",
    "grand_final",
  ];

  // Render TIER_ORDER first, then any extra tiers found in the data so
  // new tiers don't get silently dropped from the bracket view.
  const orderedTiers = TIER_ORDER.filter((tier) => tierMap.has(tier));
  const extraTiers = Array.from(tierMap.keys()).filter((tier) => !TIER_ORDER.includes(tier));
  return [...orderedTiers, ...extraTiers].map((tier) => {
    const stageMap = tierMap.get(tier)!;
    const stages = STAGE_ORDER.filter((s) => stageMap.has(s)).map((stage) => ({
      stage,
      stageLabel: stageLabel(stage),
      rounds: [...(stageMap.get(stage) ?? [])].sort((a, b) => a.round - b.round),
    }));
    return { tier, stages };
  });
}

export type RoundRobinRecord = {
  entrantId: string;
  entrantName: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
};

export function computeRoundRobinStandings(
  matches: MatchRow[],
  teams: { id: string; name: string }[]
): RoundRobinRecord[] {
  const records = new Map<string, RoundRobinRecord>(
    teams.map((t) => [
      t.id,
      {
        entrantId: t.id,
        entrantName: t.name,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      },
    ])
  );

  for (const match of matches) {
    if (match.status !== "completed" || !match.entrant1Id || !match.entrant2Id) continue;
    // Skip matches with missing scores (e.g. walkovers/forfeits): defaulting
    // null to 0 would create a 0-0 "tie" that the else branch resolves as a
    // Team 2 win.
    if (match.score1 == null || match.score2 == null) continue;
    const r1 = records.get(match.entrant1Id);
    const r2 = records.get(match.entrant2Id);
    if (!r1 || !r2) continue;

    const s1 = match.score1;
    const s2 = match.score2;

    r1.pointsFor += s1;
    r1.pointsAgainst += s2;
    r2.pointsFor += s2;
    r2.pointsAgainst += s1;

    if (s1 > s2) {
      r1.wins += 1;
      r2.losses += 1;
    } else {
      r2.wins += 1;
      r1.losses += 1;
    }
  }

  return [...records.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const diffA = a.pointsFor - a.pointsAgainst;
    const diffB = b.pointsFor - b.pointsAgainst;
    if (diffB !== diffA) return diffB - diffA;
    return a.entrantName.localeCompare(b.entrantName);
  });
}

export function matchEntrantLabel(name: string | null, isBye: boolean, isTbd?: boolean): string {
  if (isBye) return "Bye";
  if (isTbd) return "TBD";
  return name ?? "TBD";
}

export function isByeMatch(match: MatchRow): boolean {
  return (
    match.status === "completed" &&
    (!match.entrant1Id || !match.entrant2Id) &&
    !!(match.entrant1Id || match.entrant2Id)
  );
}

export function entrant2Label(match: MatchRow): string {
  if (!match.entrant2Id) {
    return isByeMatch(match) ? "Bye" : "TBD";
  }
  return match.entrant2Name ?? "TBD";
}
