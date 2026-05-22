import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

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

/**
 * Lists all tournaments for a given tenant workspace.
 */
export const listByTenant = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tournaments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .collect();
  },
});

/**
 * Gets the active registration-open tournament for a given tenant.
 */
export const getActiveTournament = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tournaments")
      .withIndex("by_tenantId_and_status", (q) =>
        q.eq("tenantId", args.tenantId).eq("status", "registration_open")
      )
      .first();
  },
});

/**
 * Gets a single tournament by its ID.
 */
export const getById = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.tournamentId);
  },
});

/**
 * Gets all entrants (doubles teams) registered in a tournament,
 * merging the actual player names for rendering.
 */
export const getRegisteredTeams = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const entrants = await ctx.db
      .query("tournamentEntrants")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();

    return await Promise.all(
      entrants.map(async (entrant) => {
        const [p1, p2] = await Promise.all([
          ctx.db.get(entrant.player1Id),
          ctx.db.get(entrant.player2Id),
        ]);
        return {
          id: entrant._id,
          name: entrant.name,
          skillTier: entrant.skillTier,
          players: [
            p1 ? `${p1.firstName} ${p1.lastName}` : "Unknown Player",
            p2 ? `${p2.firstName} ${p2.lastName}` : "Unknown Player",
          ],
        };
      })
    );
  },
});

/**
 * Generates a Round Robin bracket for a tournament.
 * Deletes any existing matches for the tournament and inserts the newly generated schedule.
 */
export const generateBracket = mutation({
  args: {
    tenantId: v.id("tenants"),
    tournamentId: v.id("tournaments"),
  },
  handler: async (ctx, args) => {
    // 1. Verify tournament exists and matches tenant context
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      return { success: false, error: "Tournament not found." };
    }
    if (tournament.tenantId !== args.tenantId) {
      return { success: false, error: "Tournament workspace mismatch." };
    }
    if (tournament.status !== "registration_open" && tournament.status !== "draft") {
      return { success: false, error: "Tournament must be in Draft or Registration Open status." };
    }

    // 2. Fetch all entrants (doubles teams) for the tournament
    const entrants = await ctx.db
      .query("tournamentEntrants")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();

    if (entrants.length < 2) {
      return { success: false, error: "Not enough teams registered to generate a bracket." };
    }

    // 3. Group entrants by skill tier
    const entrantsByTier = entrants.reduce((acc, entrant) => {
      const tier = entrant.skillTier;
      if (!acc[tier]) acc[tier] = [];
      acc[tier].push(entrant);
      return acc;
    }, {} as Record<string, typeof entrants>);

    // 4. Generate Round Robin match schedule (Circle Method) per tier
    const matchesToInsert: Omit<Doc<"tournamentMatches">, "_id" | "_creationTime">[] = [];
    let generatedTotal = 0;

    for (const [, tierEntrants] of Object.entries(entrantsByTier)) {
      if (tierEntrants.length < 2) continue; // Skip tier if there is only 1 entrant

      const schedule: RoundRobinMatch[] = [];
      const list: EntrantMinimal[] = tierEntrants.map(e => ({ id: e._id, name: e.name }));

      // Circle method rotation setup
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
            schedule.push({
              round: round + 1,
              entrant1: actualTeam2,
              entrant2: null,
            });
            continue;
          }

          schedule.push({
            round: round + 1,
            entrant1: actualTeam1,
            entrant2: actualTeam2,
          });
        }
      }

      // Convert generated matches into database schema shape
      let order = 1;
      for (const sm of schedule) {
        const matchData: Omit<Doc<"tournamentMatches">, "_id" | "_creationTime"> = {
          tournamentId: args.tournamentId,
          entrant1Id: sm.entrant1.id as Id<"tournamentEntrants">,
          entrant2Id: sm.entrant2 ? sm.entrant2.id as Id<"tournamentEntrants"> : undefined,
          status: "pending",
          roundNumber: sm.round,
          matchOrder: order++,
          createdAt: Date.now(),
        };
        matchesToInsert.push(matchData);
      }
      generatedTotal += schedule.length;
    }

    if (matchesToInsert.length === 0) {
      return { success: false, error: "Failed to generate any valid matches. Ensure at least one tier has 2+ teams." };
    }

    // 5. Execute transaction: Clear old bracket, insert new bracket, lock registration
    // Delete existing matches
    const oldMatches = await ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();

    for (const m of oldMatches) {
      await ctx.db.delete(m._id);
    }

    // Insert new matches
    for (const m of matchesToInsert) {
      await ctx.db.insert("tournamentMatches", m);
    }

    // Lock registration by moving status to bracket_generated
    await ctx.db.patch(args.tournamentId, {
      status: "bracket_generated",
    });

    return { 
      success: true, 
      message: `Successfully generated ${generatedTotal} matches across all active skill tiers!` 
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
    const tournamentId = await ctx.db.insert("tournaments", {
      tenantId: args.tenantId,
      name: args.name.trim(),
      date: args.date,
      format: args.format,
      location: args.location?.trim() || undefined,
      status: "draft",
      createdAt: Date.now(),
    });
    return { success: true, tournamentId };
  },
});

export const updateTournamentStatus = mutation({
  args: {
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
    const allowed = TOURNAMENT_LIFECYCLE[tournament.status] ?? [];
    if (!allowed.includes(args.status)) {
      return { success: false, error: `Cannot transition from '${tournament.status}' to '${args.status}'.` };
    }
    await ctx.db.patch(args.tournamentId, { status: args.status });
    return { success: true };
  },
});

export const getTournamentBracket = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .order("asc")
      .collect();

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
        return {
          ...match,
          entrant1Name: entrant1?.name ?? null,
          entrant2Name: entrant2?.name ?? null,
          winnerName: winner?.name ?? null,
        };
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

export const recordTournamentScore = mutation({
  args: {
    matchId: v.id("tournamentMatches"),
    score1: v.number(),
    score2: v.number(),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) {
      return { success: false, error: "Match not found." };
    }
    if (match.status === "completed") {
      return { success: false, error: "Match is already completed." };
    }
    if (!match.entrant1Id || !match.entrant2Id) {
      return { success: false, error: "Tournament match must have two entrants before scoring." };
    }
    if (args.score1 < 0 || args.score2 < 0) {
      return { success: false, error: "Scores cannot be negative." };
    }
    if (args.score1 === args.score2) {
      return { success: false, error: "Tied scores are not supported." };
    }

    const winnerId = args.score1 > args.score2 ? match.entrant1Id : match.entrant2Id;
    await ctx.db.patch(args.matchId, {
      score1: args.score1,
      score2: args.score2,
      status: "completed",
      winnerId,
    });
    return { success: true, winnerId };
  },
});
