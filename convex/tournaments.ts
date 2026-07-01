import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireRole } from "./lib/authz";

// Helper structure for bracket generation
type EntrantMinimal = {
  id: Id<"tournamentEntrants"> | string;
  name: string;
};

type RoundRobinMatch = {
  round: number;
  entrant1: EntrantMinimal;
  entrant2: EntrantMinimal | null; // null is a Bye
};

const BYE_ID = "BYE";
const TOURNAMENT_ADMIN_ROLES = ["owner", "game_master"] as const;
const MAX_TOURNAMENTS = 100;
const MAX_TOURNAMENT_TEAMS = 100;
const MAX_TOURNAMENT_MATCHES = 500;

function toPublicTournament(tournament: Doc<"tournaments">) {
  return {
    _id: tournament._id,
    name: tournament.name,
    date: tournament.date,
    location: tournament.location,
    status: tournament.status,
    format: tournament.format,
  };
}

function toPublicMatch(
  match: Doc<"tournamentMatches">,
  names: {
    entrant1Name: string | null;
    entrant2Name: string | null;
    winnerName: string | null;
  },
) {
  return {
    _id: match._id,
    entrant1Id: match.entrant1Id,
    entrant2Id: match.entrant2Id,
    courtName: match.courtName,
    score1: match.score1,
    score2: match.score2,
    status: match.status,
    roundNumber: match.roundNumber,
    matchOrder: match.matchOrder,
    winnerId: match.winnerId,
    skillTier: match.skillTier,
    bracketStage: match.bracketStage,
    isIfNecessary: match.isIfNecessary,
    ...names,
  };
}

function requiredName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

/**
 * Lists all tournaments for a given tenant workspace.
 */
export const listByTenant = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.tenantId, TOURNAMENT_ADMIN_ROLES);
    return await ctx.db
      .query("tournaments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(MAX_TOURNAMENTS);
  },
});

/**
 * Gets the active registration-open tournament for a given tenant.
 */
export const getActiveTournament = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant || tenant.status !== "active") return null;
    const tournament = await ctx.db
      .query("tournaments")
      .withIndex("by_tenantId_and_status", (q) =>
        q.eq("tenantId", args.tenantId).eq("status", "registration_open")
      )
      .first();
    return tournament ? toPublicTournament(tournament) : null;
  },
});

/**
 * Gets a single tournament by its ID.
 */
export const getById = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) return null;
    const tenant = await ctx.db.get(tournament.tenantId);
    if (!tenant || tenant.status !== "active") return null;
    return toPublicTournament(tournament);
  },
});

/**
 * Gets all entrants (doubles teams) registered in a tournament,
 * merging the actual player names for rendering.
 */
export const getRegisteredTeams = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) return [];
    const tenant = await ctx.db.get(tournament.tenantId);
    if (!tenant || tenant.status !== "active") return [];

    const entrants = await ctx.db
      .query("tournamentEntrants")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .take(MAX_TOURNAMENT_TEAMS);

    return await Promise.all(
      entrants.map(async (entrant) => {
        const [p1, p2] = await Promise.all([
          ctx.db.get(entrant.player1Id),
          ctx.db.get(entrant.player2Id),
        ]);
        const player1 = p1?.tenantId === tournament.tenantId ? p1 : null;
        const player2 = p2?.tenantId === tournament.tenantId ? p2 : null;
        return {
          id: entrant._id,
          name: entrant.name,
          skillTier: entrant.skillTier,
          seed: entrant.seed,
          createdAt: entrant.createdAt,
          players: [
            player1 ? `${player1.firstName} ${player1.lastName}` : "Unknown Player",
            player2 ? `${player2.firstName} ${player2.lastName}` : "Unknown Player",
          ],
        };
      })
    );
  },
});

type SkillTier = Doc<"tournamentEntrants">["skillTier"];
type BracketStage = NonNullable<Doc<"tournamentMatches">["bracketStage"]>;
type SourceOutcome = NonNullable<Doc<"tournamentMatches">["entrant1SourceOutcome"]>;
type TournamentMatchInsert = Omit<Doc<"tournamentMatches">, "_id" | "_creationTime">;
type MatchOrderRef = { value: number };
type MatchNode = { id: Id<"tournamentMatches"> };
type ScoreValidation =
  | { success: true; winnerId: Id<"tournamentEntrants"> }
  | { success: false; error: string };

function nextPowerOfTwo(value: number) {
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

function seededEntrants(entrants: Doc<"tournamentEntrants">[]) {
  return [...entrants].sort((a, b) => {
    const seedA = a.seed ?? Number.MAX_SAFE_INTEGER;
    const seedB = b.seed ?? Number.MAX_SAFE_INTEGER;
    if (seedA !== seedB) return seedA - seedB;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a._id.localeCompare(b._id);
  });
}

function groupEntrantsByTier(entrants: Doc<"tournamentEntrants">[]) {
  return entrants.reduce((acc, entrant) => {
    const tier = entrant.skillTier;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(entrant);
    return acc;
  }, {} as Partial<Record<SkillTier, Doc<"tournamentEntrants">[]>>);
}

function validateScores(
  match: Doc<"tournamentMatches">,
  score1: number,
  score2: number
): ScoreValidation {
  if (!match.entrant1Id || !match.entrant2Id) {
    return { success: false, error: "Tournament match must have two entrants before scoring." };
  }
  if (score1 < 0 || score2 < 0) {
    return { success: false, error: "Scores cannot be negative." };
  }
  if (!Number.isInteger(score1) || !Number.isInteger(score2)) {
    return { success: false, error: "Scores must be whole numbers." };
  }
  if (score1 === score2) {
    return { success: false, error: "Tied scores are not supported." };
  }

  return {
    success: true,
    winnerId: score1 > score2 ? match.entrant1Id : match.entrant2Id,
  };
}

function createMatchData(args: {
  tournamentId: Id<"tournaments">;
  roundNumber: number;
  matchOrder: number;
  skillTier: SkillTier;
  bracketStage: BracketStage;
  entrant1Id?: Id<"tournamentEntrants">;
  entrant2Id?: Id<"tournamentEntrants">;
  entrant1SourceMatchId?: Id<"tournamentMatches">;
  entrant1SourceOutcome?: SourceOutcome;
  entrant2SourceMatchId?: Id<"tournamentMatches">;
  entrant2SourceOutcome?: SourceOutcome;
  isIfNecessary?: boolean;
}): TournamentMatchInsert {
  return {
    tournamentId: args.tournamentId,
    entrant1Id: args.entrant1Id,
    entrant2Id: args.entrant2Id,
    status: "pending",
    roundNumber: args.roundNumber,
    matchOrder: args.matchOrder,
    skillTier: args.skillTier,
    bracketStage: args.bracketStage,
    entrant1SourceMatchId: args.entrant1SourceMatchId,
    entrant1SourceOutcome: args.entrant1SourceOutcome,
    entrant2SourceMatchId: args.entrant2SourceMatchId,
    entrant2SourceOutcome: args.entrant2SourceOutcome,
    isIfNecessary: args.isIfNecessary,
    createdAt: Date.now(),
  };
}

async function insertTournamentMatch(
  ctx: MutationCtx,
  data: TournamentMatchInsert
): Promise<MatchNode> {
  const id = await ctx.db.insert("tournamentMatches", data);
  return { id };
}

async function deleteExistingTournamentMatches(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">
) {
  const oldMatches = await ctx.db
    .query("tournamentMatches")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();

  for (const match of oldMatches) {
    await ctx.db.delete(match._id);
  }
}

async function generateRoundRobinTier(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  tierEntrants: Doc<"tournamentEntrants">[],
  skillTier: SkillTier,
  matchOrder: MatchOrderRef
) {
  const schedule: RoundRobinMatch[] = [];
  const list: EntrantMinimal[] = seededEntrants(tierEntrants).map((entrant) => ({
    id: entrant._id,
    name: entrant.name,
  }));

  if (list.length % 2 !== 0) {
    list.push({ id: BYE_ID, name: "Bye" });
  }

  const numEntrants = list.length;
  const numRounds = numEntrants - 1;
  const matchesPerRound = numEntrants / 2;

  for (let round = 0; round < numRounds; round++) {
    for (let matchIndex = 0; matchIndex < matchesPerRound; matchIndex++) {
      const home = (round + matchIndex) % (numEntrants - 1);
      let away = (numEntrants - 1 - matchIndex + round) % (numEntrants - 1);

      if (matchIndex === 0) {
        away = numEntrants - 1;
      }

      const team1 = list[home];
      const team2 = list[away];
      const actualTeam1 = team1.id === BYE_ID ? null : team1;
      const actualTeam2 = team2.id === BYE_ID ? null : team2;

      if (!actualTeam1 && !actualTeam2) continue;
      if (!actualTeam1) {
        if (!actualTeam2) continue;
        schedule.push({ round: round + 1, entrant1: actualTeam2, entrant2: null });
        continue;
      }
      schedule.push({ round: round + 1, entrant1: actualTeam1, entrant2: actualTeam2 });
    }
  }

  for (const scheduledMatch of schedule) {
    await ctx.db.insert(
      "tournamentMatches",
      createMatchData({
        tournamentId,
        entrant1Id: scheduledMatch.entrant1.id as Id<"tournamentEntrants">,
        entrant2Id: scheduledMatch.entrant2
          ? scheduledMatch.entrant2.id as Id<"tournamentEntrants">
          : undefined,
        roundNumber: scheduledMatch.round,
        matchOrder: matchOrder.value++,
        skillTier,
        bracketStage: "round_robin",
      })
    );
  }

  return schedule.length;
}

async function generateSingleEliminationTier(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  tierEntrants: Doc<"tournamentEntrants">[],
  skillTier: SkillTier,
  matchOrder: MatchOrderRef
) {
  const entrants = seededEntrants(tierEntrants);
  const bracketSize = nextPowerOfTwo(entrants.length);
  const slots: Array<Doc<"tournamentEntrants"> | null> = [
    ...entrants,
    ...Array.from({ length: bracketSize - entrants.length }, () => null),
  ];
  let generated = 0;
  let roundNumber = 1;
  let currentRound: MatchNode[] = [];

  for (let index = 0; index < bracketSize / 2; index++) {
    const entrant1 = slots[index];
    const entrant2 = slots[bracketSize - 1 - index];
    const node = await insertTournamentMatch(
      ctx,
      createMatchData({
        tournamentId,
        entrant1Id: entrant1?._id,
        entrant2Id: entrant2?._id,
        roundNumber,
        matchOrder: matchOrder.value++,
        skillTier,
        bracketStage: "single_elimination",
      })
    );
    currentRound.push(node);
    generated += 1;
  }

  while (currentRound.length > 1) {
    roundNumber += 1;
    const nextRound: MatchNode[] = [];
    for (let index = 0; index < currentRound.length; index += 2) {
      const node = await insertTournamentMatch(
        ctx,
        createMatchData({
          tournamentId,
          entrant1SourceMatchId: currentRound[index].id,
          entrant1SourceOutcome: "winner",
          entrant2SourceMatchId: currentRound[index + 1]?.id,
          entrant2SourceOutcome: currentRound[index + 1] ? "winner" : undefined,
          roundNumber,
          matchOrder: matchOrder.value++,
          skillTier,
          bracketStage: "single_elimination",
        })
      );
      nextRound.push(node);
      generated += 1;
    }
    currentRound = nextRound;
  }

  return generated;
}

async function insertSourceRound(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  sources: MatchNode[],
  outcome: SourceOutcome,
  roundNumber: number,
  skillTier: SkillTier,
  matchOrder: MatchOrderRef
) {
  const nextRound: MatchNode[] = [];
  for (let index = 0; index < sources.length; index += 2) {
    const node = await insertTournamentMatch(
      ctx,
      createMatchData({
        tournamentId,
        entrant1SourceMatchId: sources[index].id,
        entrant1SourceOutcome: outcome,
        entrant2SourceMatchId: sources[index + 1]?.id,
        entrant2SourceOutcome: sources[index + 1] ? outcome : undefined,
        roundNumber,
        matchOrder: matchOrder.value++,
        skillTier,
        bracketStage: "losers",
      })
    );
    nextRound.push(node);
  }
  return nextRound;
}

async function insertCrossLosersRound(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  losersRound: MatchNode[],
  winnersRound: MatchNode[],
  roundNumber: number,
  skillTier: SkillTier,
  matchOrder: MatchOrderRef
) {
  const nextRound: MatchNode[] = [];
  const matchCount = Math.max(losersRound.length, winnersRound.length);
  for (let index = 0; index < matchCount; index++) {
    const node = await insertTournamentMatch(
      ctx,
      createMatchData({
        tournamentId,
        entrant1SourceMatchId: losersRound[index]?.id,
        entrant1SourceOutcome: losersRound[index] ? "winner" : undefined,
        entrant2SourceMatchId: winnersRound[index]?.id,
        entrant2SourceOutcome: winnersRound[index] ? "loser" : undefined,
        roundNumber,
        matchOrder: matchOrder.value++,
        skillTier,
        bracketStage: "losers",
      })
    );
    nextRound.push(node);
  }
  return nextRound;
}

async function generateDoubleEliminationTier(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  tierEntrants: Doc<"tournamentEntrants">[],
  skillTier: SkillTier,
  matchOrder: MatchOrderRef
) {
  const entrants = seededEntrants(tierEntrants);
  const bracketSize = nextPowerOfTwo(entrants.length);
  const slots: Array<Doc<"tournamentEntrants"> | null> = [
    ...entrants,
    ...Array.from({ length: bracketSize - entrants.length }, () => null),
  ];
  const winnersRounds: MatchNode[][] = [];
  let generated = 0;

  let currentRound: MatchNode[] = [];
  for (let index = 0; index < bracketSize / 2; index++) {
    const entrant1 = slots[index];
    const entrant2 = slots[bracketSize - 1 - index];
    const node = await insertTournamentMatch(
      ctx,
      createMatchData({
        tournamentId,
        entrant1Id: entrant1?._id,
        entrant2Id: entrant2?._id,
        roundNumber: 1,
        matchOrder: matchOrder.value++,
        skillTier,
        bracketStage: "winners",
      })
    );
    currentRound.push(node);
    generated += 1;
  }
  winnersRounds.push(currentRound);

  let winnersRoundNumber = 2;
  while (currentRound.length > 1) {
    const nextRound: MatchNode[] = [];
    for (let index = 0; index < currentRound.length; index += 2) {
      const node = await insertTournamentMatch(
        ctx,
        createMatchData({
          tournamentId,
          entrant1SourceMatchId: currentRound[index].id,
          entrant1SourceOutcome: "winner",
          entrant2SourceMatchId: currentRound[index + 1]?.id,
          entrant2SourceOutcome: currentRound[index + 1] ? "winner" : undefined,
          roundNumber: winnersRoundNumber,
          matchOrder: matchOrder.value++,
          skillTier,
          bracketStage: "winners",
        })
      );
      nextRound.push(node);
      generated += 1;
    }
    currentRound = nextRound;
    winnersRounds.push(currentRound);
    winnersRoundNumber += 1;
  }

  const winnersFinal = winnersRounds[winnersRounds.length - 1][0];
  let nextLosersRoundNumber = winnersRounds.length + 1;
  let losersFinal: MatchNode | null = null;

  if (winnersRounds.length > 1) {
    let losersRound = await insertSourceRound(
      ctx,
      tournamentId,
      winnersRounds[0],
      "loser",
      nextLosersRoundNumber++,
      skillTier,
      matchOrder
    );
    generated += losersRound.length;

    for (let winnersRoundIndex = 1; winnersRoundIndex < winnersRounds.length; winnersRoundIndex++) {
      losersRound = await insertCrossLosersRound(
        ctx,
        tournamentId,
        losersRound,
        winnersRounds[winnersRoundIndex],
        nextLosersRoundNumber++,
        skillTier,
        matchOrder
      );
      generated += losersRound.length;

      if (losersRound.length > 1) {
        losersRound = await insertSourceRound(
          ctx,
          tournamentId,
          losersRound,
          "winner",
          nextLosersRoundNumber++,
          skillTier,
          matchOrder
        );
        generated += losersRound.length;
      }
    }
    losersFinal = losersRound[0] ?? null;
  }

  await insertTournamentMatch(
    ctx,
    createMatchData({
      tournamentId,
      entrant1SourceMatchId: winnersFinal.id,
      entrant1SourceOutcome: "winner",
      entrant2SourceMatchId: losersFinal?.id ?? winnersFinal.id,
      entrant2SourceOutcome: losersFinal ? "winner" : "loser",
      roundNumber: nextLosersRoundNumber,
      matchOrder: matchOrder.value++,
      skillTier,
      bracketStage: "grand_final",
    })
  );
  generated += 1;

  return generated;
}

function sourceMatchIds(match: Doc<"tournamentMatches">) {
  return [match.entrant1SourceMatchId, match.entrant2SourceMatchId].filter(
    (id): id is Id<"tournamentMatches"> => !!id
  );
}

async function resolveSourceOutcome(
  ctx: MutationCtx,
  sourceMatchId: Id<"tournamentMatches">,
  outcome: SourceOutcome
) {
  const sourceMatch = await ctx.db.get(sourceMatchId);
  if (!sourceMatch || sourceMatch.status !== "completed" || !sourceMatch.winnerId) {
    return undefined;
  }
  if (outcome === "winner") {
    return sourceMatch.winnerId;
  }
  if (!sourceMatch.entrant1Id || !sourceMatch.entrant2Id) {
    return undefined;
  }
  return sourceMatch.winnerId === sourceMatch.entrant1Id
    ? sourceMatch.entrant2Id
    : sourceMatch.entrant1Id;
}

async function sourcesAreComplete(ctx: MutationCtx, match: Doc<"tournamentMatches">) {
  for (const sourceMatchId of sourceMatchIds(match)) {
    const sourceMatch = await ctx.db.get(sourceMatchId);
    if (!sourceMatch || sourceMatch.status !== "completed") {
      return false;
    }
  }
  return true;
}

async function maybeAutoAdvanceMatch(
  ctx: MutationCtx,
  matchId: Id<"tournamentMatches">
) {
  const match = await ctx.db.get(matchId);
  if (!match || match.status !== "pending" || match.bracketStage === "round_robin") {
    return;
  }
  if (!(await sourcesAreComplete(ctx, match))) {
    return;
  }

  const entrants = [match.entrant1Id, match.entrant2Id].filter(
    (id): id is Id<"tournamentEntrants"> => !!id
  );
  if (entrants.length !== 1) {
    return;
  }

  await ctx.db.patch(match._id, {
    status: "completed",
    winnerId: entrants[0],
  });
  const completedMatch = await ctx.db.get(match._id);
  if (completedMatch) {
    await advanceFromMatch(ctx, completedMatch);
  }
}

async function advanceFromMatch(
  ctx: MutationCtx,
  completedMatch: Doc<"tournamentMatches">
) {
  const downstreamMatches = await ctx.db
    .query("tournamentMatches")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", completedMatch.tournamentId))
    .collect();

  for (const downstream of downstreamMatches) {
    if (downstream.status === "completed") {
      continue;
    }

    const patch: Partial<Doc<"tournamentMatches">> = {};
    if (
      downstream.entrant1SourceMatchId === completedMatch._id &&
      downstream.entrant1SourceOutcome
    ) {
      const entrantId = await resolveSourceOutcome(
        ctx,
        completedMatch._id,
        downstream.entrant1SourceOutcome
      );
      if (entrantId) patch.entrant1Id = entrantId;
    }
    if (
      downstream.entrant2SourceMatchId === completedMatch._id &&
      downstream.entrant2SourceOutcome
    ) {
      const entrantId = await resolveSourceOutcome(
        ctx,
        completedMatch._id,
        downstream.entrant2SourceOutcome
      );
      if (entrantId) patch.entrant2Id = entrantId;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(downstream._id, patch);
    }
    if (
      downstream.entrant1SourceMatchId === completedMatch._id ||
      downstream.entrant2SourceMatchId === completedMatch._id
    ) {
      await maybeAutoAdvanceMatch(ctx, downstream._id);
    }
  }
}

function getDependentMatches(
  allMatches: Doc<"tournamentMatches">[],
  completedMatch: Doc<"tournamentMatches">
) {
  const bySource = new Map<Id<"tournamentMatches">, Doc<"tournamentMatches">[]>();
  for (const match of allMatches) {
    for (const sourceId of sourceMatchIds(match)) {
      const current = bySource.get(sourceId) ?? [];
      current.push(match);
      bySource.set(sourceId, current);
    }
  }

  const dependents: Doc<"tournamentMatches">[] = [];
  const visited = new Set<Id<"tournamentMatches">>();
  const queue = [...(bySource.get(completedMatch._id) ?? [])];

  if (completedMatch.bracketStage === "grand_final" && !completedMatch.isIfNecessary) {
    queue.push(
      ...allMatches.filter(
        (match) => match.bracketStage === "grand_final" && match.isIfNecessary
      )
    );
  }

  let head = 0;
  while (head < queue.length) {
    const next = queue[head++];
    if (visited.has(next._id)) {
      continue;
    }
    visited.add(next._id);
    dependents.push(next);
    queue.push(...(bySource.get(next._id) ?? []));
  }

  return dependents;
}

async function findCompletedDependentMatch(
  ctx: MutationCtx,
  completedMatch: Doc<"tournamentMatches">
) {
  const allMatches = await ctx.db
    .query("tournamentMatches")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", completedMatch.tournamentId))
    .collect();

  return getDependentMatches(allMatches, completedMatch).find(
    (match) => match.status === "completed"
  );
}

async function removePendingResetFinalIfInvalid(
  ctx: MutationCtx,
  completedMatch: Doc<"tournamentMatches">
) {
  if (
    completedMatch.bracketStage !== "grand_final" ||
    completedMatch.isIfNecessary ||
    !completedMatch.entrant1Id ||
    completedMatch.winnerId !== completedMatch.entrant1Id
  ) {
    return;
  }

  const tournamentMatches = await ctx.db
    .query("tournamentMatches")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", completedMatch.tournamentId))
    .collect();

  for (const match of tournamentMatches) {
    if (
      match.bracketStage === "grand_final" &&
      match.isIfNecessary &&
      match.status === "pending"
    ) {
      await ctx.db.delete(match._id);
    }
  }
}

async function autoAdvanceTournamentByes(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">
) {
  const matches = await ctx.db
    .query("tournamentMatches")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();

  for (const match of matches) {
    await maybeAutoAdvanceMatch(ctx, match._id);
  }
}

/**
 * Generates a bracket for the tournament format.
 * Deletes any existing matches for the tournament and inserts the newly generated structure.
 */
export const generateBracket = mutation({
  args: {
    tenantId: v.id("tenants"),
    tournamentId: v.id("tournaments"),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      return { success: false, error: "Tournament not found." };
    }
    await requireRole(ctx, tournament.tenantId, TOURNAMENT_ADMIN_ROLES);

    if (tournament.tenantId !== args.tenantId) {
      return { success: false, error: "Tournament workspace mismatch." };
    }
    if (
      tournament.status !== "registration_open" &&
      tournament.status !== "draft" &&
      tournament.status !== "registration_closed"
    ) {
      return { success: false, error: "Tournament must be in Draft, Registration Open, or Registration Closed status." };
    }

    const entrants = await ctx.db
      .query("tournamentEntrants")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();

    if (entrants.length < 2) {
      return { success: false, error: "Not enough teams registered to generate a bracket." };
    }

    const entrantsByTier = groupEntrantsByTier(entrants);
    const activeTiers = Object.entries(entrantsByTier).filter(([, tierEntrants]) =>
      (tierEntrants?.length ?? 0) >= 2
    ) as Array<[SkillTier, Doc<"tournamentEntrants">[]]>;

    if (activeTiers.length === 0) {
      return { success: false, error: "Failed to generate any valid matches. Ensure at least one tier has 2+ teams." };
    }

    await deleteExistingTournamentMatches(ctx, args.tournamentId);

    let generatedTotal = 0;
    const matchOrder = { value: 1 };

    for (const [skillTier, tierEntrants] of activeTiers) {
      if (tournament.format === "round_robin") {
        generatedTotal += await generateRoundRobinTier(
          ctx,
          args.tournamentId,
          tierEntrants,
          skillTier,
          matchOrder
        );
      } else if (tournament.format === "single_elimination") {
        generatedTotal += await generateSingleEliminationTier(
          ctx,
          args.tournamentId,
          tierEntrants,
          skillTier,
          matchOrder
        );
      } else {
        generatedTotal += await generateDoubleEliminationTier(
          ctx,
          args.tournamentId,
          tierEntrants,
          skillTier,
          matchOrder
        );
      }
    }

    await autoAdvanceTournamentByes(ctx, args.tournamentId);

    await ctx.db.patch(args.tournamentId, {
      status: "bracket_generated",
    });

    return {
      success: true,
      message: `Successfully generated ${generatedTotal} matches across all active skill tiers!`,
    };
  },
});

const TOURNAMENT_LIFECYCLE: Record<string, string[]> = {
  draft: ["registration_open", "cancelled"],
  registration_open: ["registration_closed", "cancelled"],
  registration_closed: ["bracket_generated", "registration_open", "cancelled"],
  bracket_generated: ["live", "registration_closed", "cancelled"],
  live: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * Creates a draft tournament for a tenant workspace.
 */
export const createTournament = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    date: v.number(),
    format: v.union(
      v.literal("single_elimination"),
      v.literal("double_elimination"),
      v.literal("round_robin")
    ),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.tenantId, TOURNAMENT_ADMIN_ROLES);

    const name = requiredName(args.name);
    if (!name) {
      return { success: false, error: "Tournament name is required." };
    }

    const tournamentId = await ctx.db.insert("tournaments", {
      tenantId: args.tenantId,
      name,
      date: args.date,
      format: args.format,
      location: args.location?.trim() || undefined,
      status: "draft",
      createdAt: Date.now(),
    });
    return { success: true, tournamentId };
  },
});

/**
 * Moves a tournament through the allowed lifecycle transitions for its current status.
 */
export const updateTournamentStatus = mutation({
  args: {
    tenantId: v.id("tenants"),
    tournamentId: v.id("tournaments"),
    status: v.union(
      v.literal("draft"),
      v.literal("registration_open"),
      v.literal("registration_closed"),
      v.literal("bracket_generated"),
      v.literal("live"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      return { success: false, error: "Tournament not found." };
    }
    await requireRole(ctx, tournament.tenantId, TOURNAMENT_ADMIN_ROLES);

    if (tournament.tenantId !== args.tenantId) {
      return { success: false, error: "Tournament workspace mismatch." };
    }
    const allowed = TOURNAMENT_LIFECYCLE[tournament.status] ?? [];
    if (!allowed.includes(args.status)) {
      return { success: false, error: `Cannot transition from '${tournament.status}' to '${args.status}'.` };
    }
    await ctx.db.patch(args.tournamentId, { status: args.status });
    return { success: true };
  },
});

/**
 * Assigns, clears, and validates a team's seed within its tournament skill tier.
 */
export const updateTeamSeed = mutation({
  args: {
    tenantId: v.id("tenants"),
    tournamentId: v.id("tournaments"),
    entrantId: v.id("tournamentEntrants"),
    seed: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      return { success: false, error: "Tournament not found." };
    }
    await requireRole(ctx, tournament.tenantId, TOURNAMENT_ADMIN_ROLES);

    if (tournament.tenantId !== args.tenantId) {
      return { success: false, error: "Tournament workspace mismatch." };
    }
    if (
      tournament.status !== "draft" &&
      tournament.status !== "registration_open" &&
      tournament.status !== "registration_closed"
    ) {
      return { success: false, error: "Seeds can only be edited before bracket generation." };
    }

    const entrant = await ctx.db.get(args.entrantId);
    if (!entrant || entrant.tournamentId !== args.tournamentId) {
      return { success: false, error: "Team not found in this tournament." };
    }

    if (args.seed !== null) {
      if (!Number.isInteger(args.seed) || args.seed <= 0) {
        return { success: false, error: "Seeds must be positive whole numbers." };
      }

      const tournamentEntrants = await ctx.db
        .query("tournamentEntrants")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .collect();

      const duplicate = tournamentEntrants.find(
        (candidate) =>
          candidate._id !== args.entrantId &&
          candidate.skillTier === entrant.skillTier &&
          candidate.seed === args.seed
      );
      if (duplicate) {
        return { success: false, error: `Seed ${args.seed} is already assigned in ${entrant.skillTier}.` };
      }
    }

    await ctx.db.patch(args.entrantId, {
      seed: args.seed ?? undefined,
    });

    return { success: true };
  },
});

/**
 * Returns tournament bracket rounds enriched with entrant and winner names.
 */
export const getTournamentBracket = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) return [];
    const tenant = await ctx.db.get(tournament.tenantId);
    if (!tenant || tenant.status !== "active") return [];

    const matches = await ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .order("asc")
      .take(MAX_TOURNAMENT_MATCHES);

    const sortedMatches = [...matches].sort((a, b) => {
      if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
      return a.matchOrder - b.matchOrder;
    });

    const enriched = await Promise.all(
      sortedMatches.map(async (match) => {
        const [entrant1, entrant2, winner] = await Promise.all([
          match.entrant1Id ? ctx.db.get(match.entrant1Id) : null,
          match.entrant2Id ? ctx.db.get(match.entrant2Id) : null,
          match.winnerId ? ctx.db.get(match.winnerId) : null,
        ]);
        return toPublicMatch(match, {
          entrant1Name: entrant1?.name ?? null,
          entrant2Name: entrant2?.name ?? null,
          winnerName: winner?.name ?? null,
        });
      })
    );

    const byRound = enriched.reduce((acc, m) => {
      if (!acc[m.roundNumber]) acc[m.roundNumber] = [];
      acc[m.roundNumber].push(m);
      return acc;
    }, {} as Record<number, typeof enriched>);

    return Object.entries(byRound)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([round, roundMatches]) => ({
        round: Number(round),
        matches: [...roundMatches].sort((a, b) => a.matchOrder - b.matchOrder),
      }));
  },
});

async function maybeCreateResetFinal(
  ctx: MutationCtx,
  completedMatch: Doc<"tournamentMatches">
) {
  if (
    completedMatch.bracketStage !== "grand_final" ||
    completedMatch.isIfNecessary ||
    !completedMatch.entrant1Id ||
    !completedMatch.entrant2Id ||
    completedMatch.winnerId !== completedMatch.entrant2Id
  ) {
    return;
  }

  const tournament = await ctx.db.get(completedMatch.tournamentId);
  if (!tournament || tournament.format !== "double_elimination") {
    return;
  }

  const tournamentMatches = await ctx.db
    .query("tournamentMatches")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", completedMatch.tournamentId))
    .collect();

  const resetAlreadyExists = tournamentMatches.some(
    (match) => match.bracketStage === "grand_final" && match.isIfNecessary
  );
  if (resetAlreadyExists) {
    return;
  }

  const nextMatchOrder =
    tournamentMatches.reduce((max, match) => Math.max(max, match.matchOrder), 0) + 1;

  await ctx.db.insert("tournamentMatches", {
    tournamentId: completedMatch.tournamentId,
    entrant1Id: completedMatch.entrant1Id,
    entrant2Id: completedMatch.entrant2Id,
    status: "pending",
    roundNumber: completedMatch.roundNumber + 1,
    matchOrder: nextMatchOrder,
    skillTier: completedMatch.skillTier,
    bracketStage: "grand_final",
    isIfNecessary: true,
    createdAt: Date.now(),
  });
}

/**
 * Gets the tenant-scoped tournament detail view, including teams, bracket rounds, and summary counts.
 */
export const getTournamentView = query({
  args: {
    tenantId: v.id("tenants"),
    tournamentId: v.id("tournaments"),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament || tournament.tenantId !== args.tenantId) {
      return null;
    }
    const tenant = await ctx.db.get(tournament.tenantId);
    if (!tenant || tenant.status !== "active") return null;

    const entrantRows = await ctx.db
      .query("tournamentEntrants")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .take(MAX_TOURNAMENT_TEAMS + 1);
    const entrantsTruncated = entrantRows.length > MAX_TOURNAMENT_TEAMS;
    const entrants = entrantRows.slice(0, MAX_TOURNAMENT_TEAMS);

    const teams = await Promise.all(
      entrants.map(async (entrant) => {
        const [p1, p2] = await Promise.all([
          ctx.db.get(entrant.player1Id),
          ctx.db.get(entrant.player2Id),
        ]);
        const player1 = p1?.tenantId === tournament.tenantId ? p1 : null;
        const player2 = p2?.tenantId === tournament.tenantId ? p2 : null;
        return {
          id: entrant._id,
          name: entrant.name,
          skillTier: entrant.skillTier,
          seed: entrant.seed,
          createdAt: entrant.createdAt,
          players: [
            player1 ? `${player1.firstName} ${player1.lastName}` : "Unknown Player",
            player2 ? `${player2.firstName} ${player2.lastName}` : "Unknown Player",
          ],
        };
      })
    );

    const matchRows = await ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .take(MAX_TOURNAMENT_MATCHES + 1);
    const matchesTruncated = matchRows.length > MAX_TOURNAMENT_MATCHES;
    const allMatches = matchRows.slice(0, MAX_TOURNAMENT_MATCHES);

    const sortedMatches = [...allMatches].sort((a, b) => {
      if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
      return a.matchOrder - b.matchOrder;
    });

    const enrichedMatches = await Promise.all(
      sortedMatches.map(async (match) => {
        const [entrant1, entrant2, winner] = await Promise.all([
          match.entrant1Id ? ctx.db.get(match.entrant1Id) : null,
          match.entrant2Id ? ctx.db.get(match.entrant2Id) : null,
          match.winnerId ? ctx.db.get(match.winnerId) : null,
        ]);
        return toPublicMatch(match, {
          entrant1Name: entrant1?.name ?? null,
          entrant2Name: entrant2?.name ?? null,
          winnerName: winner?.name ?? null,
        });
      })
    );

    const byRound = enrichedMatches.reduce((acc, m) => {
      if (!acc[m.roundNumber]) acc[m.roundNumber] = [];
      acc[m.roundNumber].push(m);
      return acc;
    }, {} as Record<number, typeof enrichedMatches>);

    const bracketRounds = Object.entries(byRound)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([round, roundMatches]) => ({
        round: Number(round),
        matches: [...roundMatches].sort((a, b) => a.matchOrder - b.matchOrder),
      }));

    const tiers = [...new Set(entrants.map((e) => e.skillTier))];
    const completedMatches = allMatches.filter((m) => m.status === "completed").length;

    return {
      tournament: toPublicTournament(tournament),
      teams,
      bracketRounds,
      summary: {
        totalTeams: entrants.length,
        completedMatches,
        totalMatches: allMatches.length,
        tiers,
        truncated: entrantsTruncated || matchesTruncated,
      },
    };
  },
});

/**
 * Records a tournament match score, advances downstream entrants, and handles double-elimination finals.
 */
export const recordTournamentScore = mutation({
  args: {
    tenantId: v.id("tenants"),
    matchId: v.id("tournamentMatches"),
    score1: v.number(),
    score2: v.number(),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) {
      return { success: false, error: "Match not found." };
    }
    const tournament = await ctx.db.get(match.tournamentId);
    if (!tournament) {
      return { success: false, error: "Tournament not found." };
    }
    await requireRole(ctx, tournament.tenantId, TOURNAMENT_ADMIN_ROLES);

    if (tournament.tenantId !== args.tenantId) {
      return { success: false, error: "Tournament workspace mismatch." };
    }
    const scoreValidation = validateScores(match, args.score1, args.score2);
    if (!scoreValidation.success) {
      return scoreValidation;
    }

    if (match.status === "completed") {
      const completedDependent = await findCompletedDependentMatch(ctx, match);
      if (completedDependent) {
        return {
          success: false,
          error:
            "Score correction would invalidate completed downstream results. Clear downstream results before correcting this match.",
        };
      }
    }

    await ctx.db.patch(args.matchId, {
      score1: args.score1,
      score2: args.score2,
      status: "completed",
      winnerId: scoreValidation.winnerId,
    });

    const completedMatch = await ctx.db.get(args.matchId);
    if (completedMatch) {
      await advanceFromMatch(ctx, completedMatch);
      await removePendingResetFinalIfInvalid(ctx, completedMatch);
      await maybeCreateResetFinal(ctx, completedMatch);
    }

    return { success: true, winnerId: scoreValidation.winnerId };
  },
});
