import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// Helper structure for bracket generation
type EntrantMinimal = {
  id: Id<"tournamentEntrants">;
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
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .filter((q) => q.eq(q.field("status"), "registration_open"))
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

    const results = [];
    for (const entrant of entrants) {
      const p1 = await ctx.db.get(entrant.player1Id);
      const p2 = await ctx.db.get(entrant.player2Id);
      results.push({
        id: entrant._id,
        name: entrant.name,
        skillTier: entrant.skillTier,
        players: [
          p1 ? `${p1.firstName} ${p1.lastName}` : "Unknown Player",
          p2 ? `${p2.firstName} ${p2.lastName}` : "Unknown Player",
        ],
      });
    }
    return results;
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

    for (const [tier, tierEntrants] of Object.entries(entrantsByTier)) {
      if (tierEntrants.length < 2) continue; // Skip tier if there is only 1 entrant

      const schedule: RoundRobinMatch[] = [];
      const list = tierEntrants.map(e => ({ id: e._id, name: e.name }));

      // Circle method rotation setup
      if (list.length % 2 !== 0) {
        list.push({ id: BYE_ID as any, name: "Bye" });
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
        matchesToInsert.push({
          tournamentId: args.tournamentId,
          entrant1Id: sm.entrant1.id,
          entrant2Id: sm.entrant2?.id || undefined,
          status: "pending",
          roundNumber: sm.round,
          matchOrder: order++,
          createdAt: Date.now(),
        });
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
