/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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
