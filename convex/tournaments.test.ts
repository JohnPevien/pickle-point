/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("Tournaments", () => {
  async function seedTenant(t: ReturnType<typeof convexTest>) {
    return await t.mutation(internal.tenants.seed, {
      name: "Test Club",
      contactEmail: "gm@testclub.com",
    });
  }

  async function seedTournament(
    t: ReturnType<typeof convexTest>,
    tenantId: any,
    override: Record<string, any> = {}
  ) {
    const result = await t.mutation(api.tournaments.createTournament, {
      tenantId,
      name: override.name ?? "Spring Classic",
      date: override.date ?? Date.now(),
      format: override.format ?? "single_elimination",
      location: override.location,
    });
    return (result as { tournamentId: Id<"tournaments"> }).tournamentId;
  }

  async function seedPlayer(t: ReturnType<typeof convexTest>, tenantId: any, suffix: string) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("players", {
        tenantId,
        firstName: `Player${suffix}`,
        lastName: "Test",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        createdAt: Date.now(),
      });
    });
  }

  async function seedEntrant(
    t: ReturnType<typeof convexTest>,
    tournamentId: any,
    player1Id: any,
    player2Id: any,
    name: string
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("tournamentEntrants", {
        tournamentId,
        name,
        player1Id,
        player2Id,
        skillTier: "Novice",
        createdAt: Date.now(),
      });
    });
  }

  async function seedEntrants(
    t: ReturnType<typeof convexTest>,
    tenantId: any,
    tournamentId: any,
    count: number
  ) {
    const entrants = [];
    for (let index = 0; index < count; index++) {
      const p1 = await seedPlayer(t, tenantId, `${index}A`);
      const p2 = await seedPlayer(t, tenantId, `${index}B`);
      entrants.push(await seedEntrant(t, tournamentId, p1, p2, `Team ${index + 1}`));
    }
    return entrants;
  }

  describe("createTournament", () => {
    test("creates a tournament with draft status", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      const result = await t.mutation(api.tournaments.createTournament, {
        tenantId: tenantId as any,
        name: "Spring Classic",
        date: Date.now(),
        format: "single_elimination",
      });

      expect(result.success).toBe(true);
      const id = (result as { tournamentId: Id<"tournaments"> }).tournamentId;
      const tournament = await t.run(async (ctx) => ctx.db.get(id));
      expect(tournament?.status).toBe("draft");
      expect(tournament?.name).toBe("Spring Classic");
    });

    test("rejects blank tournament names", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      const result = await t.mutation(api.tournaments.createTournament, {
        tenantId: tenantId as any,
        name: "   ",
        date: Date.now(),
        format: "single_elimination",
      });

      expect(result).toMatchObject({
        success: false,
        error: "Tournament name is required.",
      });
    });
  });

  describe("updateTournamentStatus", () => {
    test("allows a valid status transition", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const result = await t.mutation(api.tournaments.updateTournamentStatus, {
        tournamentId: tournamentId as any,
        status: "registration_open",
      });

      expect(result.success).toBe(true);
      const tournament = await t.run(async (ctx) => ctx.db.get(tournamentId));
      expect(tournament?.status).toBe("registration_open");
    });

    test("rejects an invalid status transition", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const result = await t.mutation(api.tournaments.updateTournamentStatus, {
        tournamentId: tournamentId as any,
        status: "live",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/cannot transition/i);
    });

    test("returns error for non-existent tournament", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(tournamentId as any);
      });

      const result = await t.mutation(api.tournaments.updateTournamentStatus, {
        tournamentId: tournamentId as any,
        status: "registration_open",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/not found/i);
    });
  });

  describe("generateBracket", () => {
    test("generates round-robin matches for round_robin tournaments", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "round_robin" });
      await seedEntrants(t, tenantId, tournamentId, 4);

      const result = await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      expect(result.success).toBe(true);
      const matches = await t.run(async (ctx) => {
        return await ctx.db
          .query("tournamentMatches")
          .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId as any))
          .collect();
      });
      expect(matches).toHaveLength(6);
      expect(matches.every((match) => match.bracketStage === "round_robin")).toBe(true);
    });

    test("generates a single-elimination skeleton with byes and source refs", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "single_elimination" });
      await seedEntrants(t, tenantId, tournamentId, 3);

      const result = await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      expect(result.success).toBe(true);
      const matches = await t.run(async (ctx) => {
        return await ctx.db
          .query("tournamentMatches")
          .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId as any))
          .collect();
      });
      expect(matches).toHaveLength(3);
      expect(matches.every((match) => match.bracketStage === "single_elimination")).toBe(true);

      const byeMatch = matches.find((match) => match.roundNumber === 1 && !match.entrant2Id);
      expect(byeMatch?.status).toBe("completed");

      const final = matches.find((match) => match.roundNumber === 2);
      expect(final?.entrant1SourceMatchId || final?.entrant2SourceMatchId).toBeDefined();
      expect(final?.entrant1Id || final?.entrant2Id).toBeDefined();
    });

    test("generates winners, losers, and grand-final matches for double elimination", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "double_elimination" });
      await seedEntrants(t, tenantId, tournamentId, 4);

      const result = await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      expect(result.success).toBe(true);
      const matches = await t.run(async (ctx) => {
        return await ctx.db
          .query("tournamentMatches")
          .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId as any))
          .collect();
      });

      expect(matches.filter((match) => match.bracketStage === "winners")).toHaveLength(3);
      expect(matches.filter((match) => match.bracketStage === "losers")).toHaveLength(2);
      const grandFinals = matches.filter((match) => match.bracketStage === "grand_final");
      expect(grandFinals).toHaveLength(1);
      expect(grandFinals[0].entrant1SourceMatchId).toBeDefined();
      expect(grandFinals[0].entrant2SourceMatchId).toBeDefined();
    });

    test("advances elimination winners and creates reset final when needed", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "double_elimination" });
      await seedEntrants(t, tenantId, tournamentId, 4);

      await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      const loadMatches = async () => {
        return await t.run(async (ctx) => {
          return await ctx.db
            .query("tournamentMatches")
            .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId as any))
            .collect();
        });
      };

      let matches = await loadMatches();
      const winnersRound1 = matches
        .filter((match) => match.bracketStage === "winners" && match.roundNumber === 1)
        .sort((a, b) => a.matchOrder - b.matchOrder);
      for (const match of winnersRound1) {
        await t.mutation(api.tournaments.recordTournamentScore, {
          matchId: match._id as any,
          score1: 11,
          score2: 7,
        });
      }

      matches = await loadMatches();
      const winnersFinal = matches.find(
        (match) => match.bracketStage === "winners" && match.roundNumber === 2
      );
      expect(winnersFinal?.entrant1Id).toBeDefined();
      expect(winnersFinal?.entrant2Id).toBeDefined();

      const firstLosersMatch = matches.find(
        (match) => match.bracketStage === "losers" && match.roundNumber === 3
      );
      expect(firstLosersMatch?.entrant1Id).toBeDefined();
      expect(firstLosersMatch?.entrant2Id).toBeDefined();
      await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: firstLosersMatch!._id as any,
        score1: 11,
        score2: 8,
      });

      await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: winnersFinal!._id as any,
        score1: 11,
        score2: 6,
      });

      matches = await loadMatches();
      const losersFinal = matches.find(
        (match) => match.bracketStage === "losers" && match.roundNumber === 4
      );
      expect(losersFinal?.entrant1Id).toBeDefined();
      expect(losersFinal?.entrant2Id).toBeDefined();
      await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: losersFinal!._id as any,
        score1: 11,
        score2: 9,
      });

      matches = await loadMatches();
      const grandFinal = matches.find(
        (match) => match.bracketStage === "grand_final" && !match.isIfNecessary
      );
      expect(grandFinal?.entrant1Id).toBeDefined();
      expect(grandFinal?.entrant2Id).toBeDefined();

      await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: grandFinal!._id as any,
        score1: 7,
        score2: 11,
      });

      matches = await loadMatches();
      const resetFinal = matches.find(
        (match) => match.bracketStage === "grand_final" && match.isIfNecessary
      );
      expect(resetFinal?.status).toBe("pending");
      expect(resetFinal?.entrant1Id).toBe(grandFinal?.entrant1Id);
      expect(resetFinal?.entrant2Id).toBe(grandFinal?.entrant2Id);
    });
  });

  describe("getTournamentBracket", () => {
    test("returns empty array when no matches exist", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const bracket = await t.query(api.tournaments.getTournamentBracket, {
        tournamentId: tournamentId as any,
      });

      expect(bracket).toEqual([]);
    });

    test("returns matches grouped by round", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);
      const p1 = await seedPlayer(t, tenantId, "A");
      const p2 = await seedPlayer(t, tenantId, "B");
      const p3 = await seedPlayer(t, tenantId, "C");
      const p4 = await seedPlayer(t, tenantId, "D");
      const e1 = await seedEntrant(t, tournamentId, p1, p2, "Team Alpha");
      const e2 = await seedEntrant(t, tournamentId, p3, p4, "Team Beta");

      await t.run(async (ctx) => {
        await ctx.db.insert("tournamentMatches", {
          tournamentId: tournamentId as any,
          entrant1Id: e1 as any,
          entrant2Id: e2 as any,
          status: "pending",
          roundNumber: 1,
          matchOrder: 1,
          createdAt: Date.now(),
        });
      });

      const bracket = await t.query(api.tournaments.getTournamentBracket, {
        tournamentId: tournamentId as any,
      });

      expect(bracket).toHaveLength(1);
      expect(bracket[0].round).toBe(1);
      expect(bracket[0].matches).toHaveLength(1);
      expect(bracket[0].matches[0].entrant1Name).toBe("Team Alpha");
      expect(bracket[0].matches[0].entrant2Name).toBe("Team Beta");
    });

    test("sorts rounds and matches by round number and match order", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);
      const p1 = await seedPlayer(t, tenantId, "AA");
      const p2 = await seedPlayer(t, tenantId, "BB");
      const p3 = await seedPlayer(t, tenantId, "CC");
      const p4 = await seedPlayer(t, tenantId, "DD");
      const e1 = await seedEntrant(t, tournamentId, p1, p2, "Team One");
      const e2 = await seedEntrant(t, tournamentId, p3, p4, "Team Two");

      await t.run(async (ctx) => {
        await ctx.db.insert("tournamentMatches", {
          tournamentId: tournamentId as any,
          entrant1Id: e1 as any,
          entrant2Id: e2 as any,
          status: "pending",
          roundNumber: 2,
          matchOrder: 1,
          createdAt: Date.now(),
        });
        await ctx.db.insert("tournamentMatches", {
          tournamentId: tournamentId as any,
          entrant1Id: e1 as any,
          entrant2Id: e2 as any,
          status: "pending",
          roundNumber: 1,
          matchOrder: 2,
          createdAt: Date.now(),
        });
        await ctx.db.insert("tournamentMatches", {
          tournamentId: tournamentId as any,
          entrant1Id: e1 as any,
          entrant2Id: e2 as any,
          status: "pending",
          roundNumber: 1,
          matchOrder: 1,
          createdAt: Date.now(),
        });
      });

      const bracket = await t.query(api.tournaments.getTournamentBracket, {
        tournamentId: tournamentId as any,
      });

      expect(bracket.map((round) => round.round)).toEqual([1, 2]);
      expect(bracket[0].matches.map((match) => match.matchOrder)).toEqual([1, 2]);
    });
  });

  describe("recordTournamentScore", () => {
    test("records score and sets winner", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);
      const p1 = await seedPlayer(t, tenantId, "E");
      const p2 = await seedPlayer(t, tenantId, "F");
      const p3 = await seedPlayer(t, tenantId, "G");
      const p4 = await seedPlayer(t, tenantId, "H");
      const e1 = await seedEntrant(t, tournamentId, p1, p2, "Team One");
      const e2 = await seedEntrant(t, tournamentId, p3, p4, "Team Two");

      const matchId = await t.run(async (ctx) => {
        return await ctx.db.insert("tournamentMatches", {
          tournamentId: tournamentId as any,
          entrant1Id: e1 as any,
          entrant2Id: e2 as any,
          status: "pending",
          roundNumber: 1,
          matchOrder: 1,
          createdAt: Date.now(),
        });
      });

      const result = await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 7,
      });

      expect(result.success).toBe(true);
      expect((result as any).winnerId).toBe(e1);

      const match = await t.run(async (ctx) => ctx.db.get(matchId as Id<"tournamentMatches">));
      expect(match?.status).toBe("completed");
      expect(match?.score1).toBe(11);
      expect(match?.score2).toBe(7);
    });

    test("returns error when match is already completed", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);
      const p1 = await seedPlayer(t, tenantId, "I");
      const p2 = await seedPlayer(t, tenantId, "J");
      const p3 = await seedPlayer(t, tenantId, "K");
      const p4 = await seedPlayer(t, tenantId, "L");
      const e1 = await seedEntrant(t, tournamentId, p1, p2, "Team Three");
      const e2 = await seedEntrant(t, tournamentId, p3, p4, "Team Four");

      const matchId = await t.run(async (ctx) => {
        return await ctx.db.insert("tournamentMatches", {
          tournamentId: tournamentId as any,
          entrant1Id: e1 as any,
          entrant2Id: e2 as any,
          status: "completed",
          roundNumber: 1,
          matchOrder: 1,
          createdAt: Date.now(),
        });
      });

      const result = await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 9,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/already completed/i);
    });

    test("rejects tied, negative, and entrantless scores", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);
      const p1 = await seedPlayer(t, tenantId, "Q");
      const p2 = await seedPlayer(t, tenantId, "R");
      const p3 = await seedPlayer(t, tenantId, "S");
      const p4 = await seedPlayer(t, tenantId, "T");
      const e1 = await seedEntrant(t, tournamentId, p1, p2, "Team Seven");
      const e2 = await seedEntrant(t, tournamentId, p3, p4, "Team Eight");

      const matchId = await t.run(async (ctx) => {
        return await ctx.db.insert("tournamentMatches", {
          tournamentId: tournamentId as any,
          entrant1Id: e1 as any,
          entrant2Id: e2 as any,
          status: "pending",
          roundNumber: 1,
          matchOrder: 1,
          createdAt: Date.now(),
        });
      });

      const tied = await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 11,
      });
      expect(tied.success).toBe(false);
      expect((tied as any).error).toMatch(/tied/i);

      const negative = await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: matchId as any,
        score1: -1,
        score2: 11,
      });
      expect(negative.success).toBe(false);
      expect((negative as any).error).toMatch(/negative/i);

      const byeMatchId = await t.run(async (ctx) => {
        return await ctx.db.insert("tournamentMatches", {
          tournamentId: tournamentId as any,
          entrant1Id: e1 as any,
          status: "pending",
          roundNumber: 1,
          matchOrder: 2,
          createdAt: Date.now(),
        });
      });

      const missingEntrant = await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: byeMatchId as any,
        score1: 11,
        score2: 7,
      });
      expect(missingEntrant.success).toBe(false);
      expect((missingEntrant as any).error).toMatch(/two entrants/i);
    });

    test("returns error for non-existent match", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);
      const p1 = await seedPlayer(t, tenantId, "M");
      const p2 = await seedPlayer(t, tenantId, "N");
      const p3 = await seedPlayer(t, tenantId, "O");
      const p4 = await seedPlayer(t, tenantId, "P");
      const e1 = await seedEntrant(t, tournamentId, p1, p2, "Team Five");
      const e2 = await seedEntrant(t, tournamentId, p3, p4, "Team Six");

      const matchId = await t.run(async (ctx) => {
        return await ctx.db.insert("tournamentMatches", {
          tournamentId: tournamentId as any,
          entrant1Id: e1 as any,
          entrant2Id: e2 as any,
          status: "pending",
          roundNumber: 1,
          matchOrder: 1,
          createdAt: Date.now(),
        });
      });

      await t.run(async (ctx) => {
        await ctx.db.delete(matchId as any);
      });

      const result = await t.mutation(api.tournaments.recordTournamentScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 5,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/not found/i);
    });
  });
});
