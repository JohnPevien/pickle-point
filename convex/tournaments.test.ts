/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest, type TestConvex } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
type TestInstance = TestConvex<typeof schema>;

const ADMIN_TOKEN = "tournament_admin_token";
const ADMIN_ORG_ID = "org_tournament_tests";

function tournamentTest(): TestInstance {
  return convexTest(schema, modules).withIdentity({
    tokenIdentifier: ADMIN_TOKEN,
    issuer: "https://api.workos.com",
    organization_id: ADMIN_ORG_ID,
    role: "owner",
  }) as unknown as TestInstance;
}

describe("Tournaments", () => {
  async function seedTenant(t: TestInstance) {
    const tenantId = await t.mutation(internal.tenants.seed, {
      name: "Test Club",
      contactEmail: "gm@testclub.com",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(tenantId, { workosOrganizationId: ADMIN_ORG_ID });
      const existingUser = await ctx.db
        .query("users")
        .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", ADMIN_TOKEN))
        .first();
      if (existingUser) return;
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: ADMIN_TOKEN,
        email: "admin@testclub.com",
        tenantId,
        createdAt: now,
      });
      await ctx.db.insert("tenantMemberships", {
        tenantId,
        userId,
        role: "owner",
        status: "active",
        workosOrganizationMembershipId: "mem_tournament_admin",
        createdAt: now,
        updatedAt: now,
      });
    });
    return tenantId;
  }

  async function seedRoleActor(
    t: TestInstance,
    tenantId: Id<"tenants">,
    role: "owner" | "game_master" | "player",
    tokenIdentifier: string,
    organizationId = ADMIN_ORG_ID,
  ): Promise<TestInstance> {
    await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        tokenIdentifier,
        email: `${tokenIdentifier}@testclub.com`,
        tenantId,
        createdAt: now,
      });
      await ctx.db.insert("tenantMemberships", {
        tenantId,
        userId,
        role,
        status: "active",
        workosOrganizationMembershipId: `mem_${tokenIdentifier}`,
        createdAt: now,
        updatedAt: now,
      });
    });
    return t.withIdentity({
      tokenIdentifier,
      issuer: "https://api.workos.com",
      organization_id: organizationId,
      role,
    }) as unknown as TestInstance;
  }

  async function seedAuthorizationFixture() {
    const base = convexTest(schema, modules);
    const tenantId = await seedTenant(base);
    const gameMaster = await seedRoleActor(base, tenantId, "game_master", "tournament_gm");
    const playerActor = await seedRoleActor(base, tenantId, "player", "tournament_player");

    const otherTenantId = await base.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Other Club",
        slug: "other-tournament-club",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_other_tournament",
        status: "active",
        contactEmail: "other-tournament@club.com",
        createdAt: Date.now(),
      }),
    );
    const crossTenantOwner = await seedRoleActor(
      base,
      otherTenantId,
      "owner",
      "other_tournament_owner",
      "org_other_tournament",
    );

    const tournamentId = await base.run(async (ctx) =>
      ctx.db.insert("tournaments", {
        tenantId,
        name: "Authorization Cup",
        date: Date.now(),
        status: "registration_open",
        format: "single_elimination",
        createdAt: Date.now(),
      }),
    );
    const playerIds = await Promise.all(
      ["A", "B", "C", "D"].map((suffix) => seedPlayer(base, tenantId, suffix)),
    );
    const entrant1Id = await seedEntrant(
      base,
      tournamentId,
      playerIds[0],
      playerIds[1],
      "Team One",
      { seed: 1 },
    );
    const entrant2Id = await seedEntrant(
      base,
      tournamentId,
      playerIds[2],
      playerIds[3],
      "Team Two",
      { seed: 2 },
    );
    const matchId = await base.run(async (ctx) =>
      ctx.db.insert("tournamentMatches", {
        tournamentId,
        entrant1Id,
        entrant2Id,
        status: "pending",
        roundNumber: 1,
        matchOrder: 1,
        skillTier: "Novice",
        bracketStage: "single_elimination",
        createdAt: Date.now(),
      }),
    );

    return {
      base,
      gameMaster,
      playerActor,
      crossTenantOwner,
      tenantId,
      tournamentId,
      entrant1Id,
      matchId,
    };
  }

  type AuthorizationFixture = Awaited<ReturnType<typeof seedAuthorizationFixture>>;

  const protectedTournamentOperations = [
    {
      name: "createTournament",
      invoke: (t: TestInstance, fixture: AuthorizationFixture) =>
        t.mutation(api.tournaments.createTournament, {
          tenantId: fixture.tenantId,
          name: "Protected Cup",
          date: Date.now(),
          format: "single_elimination",
        }),
    },
    {
      name: "updateTournamentStatus",
      invoke: (t: TestInstance, fixture: AuthorizationFixture) =>
        t.mutation(api.tournaments.updateTournamentStatus, {
          tenantId: fixture.tenantId,
          tournamentId: fixture.tournamentId,
          status: "registration_closed",
        }),
    },
    {
      name: "updateTeamSeed",
      invoke: (t: TestInstance, fixture: AuthorizationFixture) =>
        t.mutation(api.tournaments.updateTeamSeed, {
          tenantId: fixture.tenantId,
          tournamentId: fixture.tournamentId,
          entrantId: fixture.entrant1Id,
          seed: 3,
        }),
    },
    {
      name: "generateBracket",
      invoke: (t: TestInstance, fixture: AuthorizationFixture) =>
        t.mutation(api.tournaments.generateBracket, {
          tenantId: fixture.tenantId,
          tournamentId: fixture.tournamentId,
        }),
    },
    {
      name: "recordTournamentScore",
      invoke: (t: TestInstance, fixture: AuthorizationFixture) =>
        t.mutation(api.tournaments.recordTournamentScore, {
          tenantId: fixture.tenantId,
          matchId: fixture.matchId,
          score1: 11,
          score2: 7,
        }),
    },
  ] as const;

  async function seedTournament(
    t: TestInstance,
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

  async function seedPlayer(t: TestInstance, tenantId: any, suffix: string) {
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
    t: TestInstance,
    tournamentId: any,
    player1Id: any,
    player2Id: any,
    name: string,
    override: Record<string, any> = {}
  ) {
    return await t.run(async (ctx) => {
      const entrant: any = {
        tournamentId,
        name,
        player1Id,
        player2Id,
        skillTier: override.skillTier ?? "Novice",
        createdAt: override.createdAt ?? Date.now(),
      };
      if (override.seed !== undefined) {
        entrant.seed = override.seed;
      }
      return await ctx.db.insert("tournamentEntrants", entrant);
    });
  }

  async function seedEntrants(
    t: TestInstance,
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

  async function loadTournamentMatches(t: TestInstance, tournamentId: any) {
    return await t.run(async (ctx) => {
      return await ctx.db
        .query("tournamentMatches" as any)
        .withIndex("by_tournament" as any, (q: any) => q.eq("tournamentId", tournamentId as any))
        .collect();
    });
  }

  describe("createTournament", () => {
    test("creates a tournament with draft status", async () => {
      const t = tournamentTest();
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
      const t = tournamentTest();
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
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const result = await t.mutation(api.tournaments.updateTournamentStatus, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        status: "registration_open",
      });

      expect(result.success).toBe(true);
      const tournament = await t.run(async (ctx) => ctx.db.get(tournamentId));
      expect(tournament?.status).toBe("registration_open");
    });

    test("rejects an invalid status transition", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const result = await t.mutation(api.tournaments.updateTournamentStatus, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        status: "live",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/cannot transition/i);
    });

    test("returns error for non-existent tournament", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(tournamentId as any);
      });

      const result = await t.mutation(api.tournaments.updateTournamentStatus, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        status: "registration_open",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/not found/i);
    });
  });

  describe("updateTeamSeed", () => {
    test("enforces unique positive seeds within each skill tier", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const p1 = await seedPlayer(t, tenantId, "SeedA1");
      const p2 = await seedPlayer(t, tenantId, "SeedA2");
      const p3 = await seedPlayer(t, tenantId, "SeedB1");
      const p4 = await seedPlayer(t, tenantId, "SeedB2");
      const p5 = await seedPlayer(t, tenantId, "SeedC1");
      const p6 = await seedPlayer(t, tenantId, "SeedC2");

      const noviceOne = await seedEntrant(t, tournamentId, p1, p2, "Novice One");
      const noviceTwo = await seedEntrant(t, tournamentId, p3, p4, "Novice Two");
      const advancedOne = await seedEntrant(t, tournamentId, p5, p6, "Advanced One", {
        skillTier: "Advanced",
      });

      const firstSeed = await t.mutation(api.tournaments.updateTeamSeed, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        entrantId: noviceOne as any,
        seed: 1,
      });
      expect(firstSeed.success).toBe(true);

      const duplicateSeed = await t.mutation(api.tournaments.updateTeamSeed, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        entrantId: noviceTwo as any,
        seed: 1,
      });
      expect(duplicateSeed.success).toBe(false);
      expect((duplicateSeed as any).error).toMatch(/already assigned/i);

      const sameSeedDifferentTier = await t.mutation(api.tournaments.updateTeamSeed, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        entrantId: advancedOne as any,
        seed: 1,
      });
      expect(sameSeedDifferentTier.success).toBe(true);

      const invalidSeed = await t.mutation(api.tournaments.updateTeamSeed, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        entrantId: noviceTwo as any,
        seed: 0,
      });
      expect(invalidSeed.success).toBe(false);
      expect((invalidSeed as any).error).toMatch(/positive/i);
    });
  });

  describe("generateBracket", () => {
    test("generates round-robin matches for round_robin tournaments", async () => {
      const t = tournamentTest();
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
      const t = tournamentTest();
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

    test("orders generated matches by seed first, then registration order", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "single_elimination" });

      const players = [];
      for (let index = 0; index < 8; index++) {
        players.push(await seedPlayer(t, tenantId, `Order${index}`));
      }

      await seedEntrant(t, tournamentId, players[0], players[1], "Team A", {
        seed: 2,
        createdAt: 1_000,
      });
      await seedEntrant(t, tournamentId, players[2], players[3], "Team B", {
        createdAt: 2_000,
      });
      await seedEntrant(t, tournamentId, players[4], players[5], "Team C", {
        seed: 1,
        createdAt: 3_000,
      });
      await seedEntrant(t, tournamentId, players[6], players[7], "Team D", {
        createdAt: 4_000,
      });

      const result = await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });
      expect(result.success).toBe(true);

      const firstRound = (await loadTournamentMatches(t, tournamentId))
        .filter((match) => match.roundNumber === 1)
        .sort((a, b) => a.matchOrder - b.matchOrder);

      const pairNames = await t.run(async (ctx) => {
        return await Promise.all(
          firstRound.map(async (match) => {
            const entrant1 = match.entrant1Id
              ? await ctx.db.get(match.entrant1Id as Id<"tournamentEntrants">)
              : null;
            const entrant2 = match.entrant2Id
              ? await ctx.db.get(match.entrant2Id as Id<"tournamentEntrants">)
              : null;
            return [entrant1?.name, entrant2?.name];
          })
        );
      });

      expect(pairNames).toEqual([
        ["Team C", "Team D"],
        ["Team A", "Team B"],
      ]);
    });

    test("generates winners, losers, and grand-final matches for double elimination", async () => {
      const t = tournamentTest();
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
      const t = tournamentTest();
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
          tenantId: tenantId as any,
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
        tenantId: tenantId as any,
        matchId: firstLosersMatch!._id as any,
        score1: 11,
        score2: 8,
      });

      await t.mutation(api.tournaments.recordTournamentScore, {
        tenantId: tenantId as any,
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
        tenantId: tenantId as any,
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
        tenantId: tenantId as any,
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
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const bracket = await t.query(api.tournaments.getTournamentBracket, {
        tournamentId: tournamentId as any,
      });

      expect(bracket).toEqual([]);
    });

    test("returns matches grouped by round", async () => {
      const t = tournamentTest();
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
      const t = tournamentTest();
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
      const t = tournamentTest();
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
        tenantId: tenantId as any,
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

    test("allows completed match correction and recomputes downstream pending slots", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "single_elimination" });
      await seedEntrants(t, tenantId, tournamentId, 4);

      await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      let matches = await loadTournamentMatches(t, tournamentId);
      const firstRound = matches
        .filter((match) => match.roundNumber === 1)
        .sort((a, b) => a.matchOrder - b.matchOrder);
      const sourceMatch = firstRound[0];
      const otherFirstRoundMatch = firstRound[1];

      await t.mutation(api.tournaments.recordTournamentScore, {
        tenantId: tenantId as any,
        matchId: sourceMatch._id as any,
        score1: 11,
        score2: 7,
      });
      await t.mutation(api.tournaments.recordTournamentScore, {
        tenantId: tenantId as any,
        matchId: otherFirstRoundMatch._id as any,
        score1: 11,
        score2: 8,
      });

      matches = await loadTournamentMatches(t, tournamentId);
      const finalBeforeCorrection = matches.find((match) => match.roundNumber === 2)!;
      const dependentSlot =
        finalBeforeCorrection.entrant1SourceMatchId === sourceMatch._id
          ? "entrant1Id"
          : "entrant2Id";
      expect(finalBeforeCorrection[dependentSlot]).toBe(sourceMatch.entrant1Id);

      const correction = await t.mutation(api.tournaments.recordTournamentScore, {
        tenantId: tenantId as any,
        matchId: sourceMatch._id as any,
        score1: 7,
        score2: 11,
      });

      expect(correction.success).toBe(true);
      expect((correction as any).winnerId).toBe(sourceMatch.entrant2Id);

      matches = await loadTournamentMatches(t, tournamentId);
      const correctedSourceMatch = matches.find((match) => match._id === sourceMatch._id);
      const finalAfterCorrection = matches.find((match) => match.roundNumber === 2)!;
      expect(correctedSourceMatch?.score1).toBe(7);
      expect(correctedSourceMatch?.score2).toBe(11);
      expect(finalAfterCorrection[dependentSlot]).toBe(sourceMatch.entrant2Id);
      expect(finalAfterCorrection.status).toBe("pending");
    });

    test("blocks score correction when completed downstream matches depend on it", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "single_elimination" });
      await seedEntrants(t, tenantId, tournamentId, 4);

      await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      let matches = await loadTournamentMatches(t, tournamentId);
      const firstRound = matches
        .filter((match) => match.roundNumber === 1)
        .sort((a, b) => a.matchOrder - b.matchOrder);
      const sourceMatch = firstRound[0];

      for (const match of firstRound) {
        await t.mutation(api.tournaments.recordTournamentScore, {
          tenantId: tenantId as any,
          matchId: match._id as any,
          score1: 11,
          score2: 8,
        });
      }

      matches = await loadTournamentMatches(t, tournamentId);
      const final = matches.find((match) => match.roundNumber === 2)!;
      await t.mutation(api.tournaments.recordTournamentScore, {
        tenantId: tenantId as any,
        matchId: final._id as any,
        score1: 11,
        score2: 6,
      });

      const correction = await t.mutation(api.tournaments.recordTournamentScore, {
        tenantId: tenantId as any,
        matchId: sourceMatch._id as any,
        score1: 7,
        score2: 11,
      });

      expect(correction.success).toBe(false);
      expect((correction as any).error).toMatch(/completed downstream/i);
    });

    test("rejects tied, negative, and entrantless scores", async () => {
      const t = tournamentTest();
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
        tenantId: tenantId as any,
        matchId: matchId as any,
        score1: 11,
        score2: 11,
      });
      expect(tied.success).toBe(false);
      expect((tied as any).error).toMatch(/tied/i);

      const negative = await t.mutation(api.tournaments.recordTournamentScore, {
        tenantId: tenantId as any,
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
        tenantId: tenantId as any,
        matchId: byeMatchId as any,
        score1: 11,
        score2: 7,
      });
      expect(missingEntrant.success).toBe(false);
      expect((missingEntrant as any).error).toMatch(/two entrants/i);
    });

    test("returns error for non-existent match", async () => {
      const t = tournamentTest();
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
        tenantId: tenantId as any,
        matchId: matchId as any,
        score1: 11,
        score2: 5,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/not found/i);
    });
  });

  describe("getTournamentView", () => {
    test("returns tournament, teams, bracket rounds, and summary", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "single_elimination" });
      await seedEntrants(t, tenantId, tournamentId, 2);

      await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      const view = await t.query(api.tournaments.getTournamentView, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      expect(view).not.toBeNull();
      expect(view!.tournament._id).toBe(tournamentId);
      expect(view!.teams).toHaveLength(2);
      expect(view!.bracketRounds).toHaveLength(1);
      expect(view!.summary.totalTeams).toBe(2);
      expect(view!.summary.totalMatches).toBe(1);
      expect(view!.summary.completedMatches).toBe(0);
    });

    test("returns null when tenantId does not match tournament", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const otherTenantId = await t.run(async (ctx) => {
        return await ctx.db.insert("tenants", {
          name: "Other Club",
          slug: "other-club",
          timezone: "Asia/Manila",
          workosOrganizationId: "org_other",
          status: "active",
          contactEmail: "other@club.com",
          createdAt: Date.now(),
        });
      });

      const view = await t.query(api.tournaments.getTournamentView, {
        tenantId: otherTenantId as any,
        tournamentId: tournamentId as any,
      });

      expect(view).toBeNull();
    });

    test("returns null for non-existent tournament", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(tournamentId as any);
      });

      const view = await t.query(api.tournaments.getTournamentView, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      expect(view).toBeNull();
    });

    test("includes entrant names in bracket rounds", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "round_robin" });
      await seedEntrants(t, tenantId, tournamentId, 3);

      await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      const view = await t.query(api.tournaments.getTournamentView, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      expect(view).not.toBeNull();
      const allMatches = view!.bracketRounds.flatMap((r) => r.matches);
      expect(allMatches.every((m) => m.entrant1Name !== null)).toBe(true);
    });

    test("summary tiers lists unique skill tiers from registered teams", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const p1 = await seedPlayer(t, tenantId, "T1A");
      const p2 = await seedPlayer(t, tenantId, "T1B");
      const p3 = await seedPlayer(t, tenantId, "T2A");
      const p4 = await seedPlayer(t, tenantId, "T2B");

      await t.run(async (ctx) => {
        await ctx.db.insert("tournamentEntrants", {
          tournamentId: tournamentId as any,
          name: "Alpha",
          player1Id: p1 as any,
          player2Id: p2 as any,
          skillTier: "Beginner",
          createdAt: Date.now(),
        });
        await ctx.db.insert("tournamentEntrants", {
          tournamentId: tournamentId as any,
          name: "Beta",
          player1Id: p3 as any,
          player2Id: p4 as any,
          skillTier: "Advanced",
          createdAt: Date.now(),
        });
      });

      const view = await t.query(api.tournaments.getTournamentView, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      expect(view!.summary.tiers).toContain("Beginner");
      expect(view!.summary.tiers).toContain("Advanced");
      expect(view!.summary.tiers).toHaveLength(2);
    });
  });

  describe("updateTournamentStatus tenant validation", () => {
    test("rejects status update when tenantId does not match", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);

      const otherTenantId = await t.run(async (ctx) => {
        return await ctx.db.insert("tenants", {
          name: "Other Club",
          slug: "other-club-2",
          timezone: "Asia/Manila",
          workosOrganizationId: "org_other_2",
          status: "active",
          contactEmail: "other2@club.com",
          createdAt: Date.now(),
        });
      });

      const result = await t.mutation(api.tournaments.updateTournamentStatus, {
        tenantId: otherTenantId as any,
        tournamentId: tournamentId as any,
        status: "registration_open",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/workspace mismatch/i);
    });
  });

  describe("recordTournamentScore tenant validation", () => {
    test("rejects score when tenantId does not match tournament", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId);
      const p1 = await seedPlayer(t, tenantId, "XV1");
      const p2 = await seedPlayer(t, tenantId, "XV2");
      const p3 = await seedPlayer(t, tenantId, "XV3");
      const p4 = await seedPlayer(t, tenantId, "XV4");
      const e1 = await seedEntrant(t, tournamentId, p1, p2, "Team XV1");
      const e2 = await seedEntrant(t, tournamentId, p3, p4, "Team XV2");

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

      const otherTenantId = await t.run(async (ctx) => {
        return await ctx.db.insert("tenants", {
          name: "Other Club",
          slug: "other-club-3",
          timezone: "Asia/Manila",
          workosOrganizationId: "org_other_3",
          status: "active",
          contactEmail: "other3@club.com",
          createdAt: Date.now(),
        });
      });

      const result = await t.mutation(api.tournaments.recordTournamentScore, {
        tenantId: otherTenantId as any,
        matchId: matchId as any,
        score1: 11,
        score2: 7,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/workspace mismatch/i);
    });
  });

  describe("generateBracket from registration_closed", () => {
    test("allows bracket generation when status is registration_closed", async () => {
      const t = tournamentTest();
      const tenantId = await seedTenant(t);
      const tournamentId = await seedTournament(t, tenantId, { format: "single_elimination" });
      await seedEntrants(t, tenantId, tournamentId, 2);

      await t.mutation(api.tournaments.updateTournamentStatus, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        status: "registration_open",
      });
      await t.mutation(api.tournaments.updateTournamentStatus, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        status: "registration_closed",
      });

      const result = await t.mutation(api.tournaments.generateBracket, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Task 3.5 authorization and public projections", () => {
    test("listByTenant rejects unauthenticated, player-role, and cross-tenant callers", async () => {
      const fixture = await seedAuthorizationFixture();

      await expect(
        fixture.base.query(api.tournaments.listByTenant, { tenantId: fixture.tenantId }),
      ).rejects.toThrow(/UNAUTHENTICATED/);
      await expect(
        fixture.playerActor.query(api.tournaments.listByTenant, { tenantId: fixture.tenantId }),
      ).rejects.toThrow(/FORBIDDEN/);
      await expect(
        fixture.crossTenantOwner.query(api.tournaments.listByTenant, {
          tenantId: fixture.tenantId,
        }),
      ).rejects.toThrow(/FORBIDDEN/);
    });

    test.each(protectedTournamentOperations)(
      "$name rejects unauthenticated, player-role, and cross-tenant callers",
      async ({ invoke }) => {
        const fixture = await seedAuthorizationFixture();

        await expect(invoke(fixture.base, fixture)).rejects.toThrow(/UNAUTHENTICATED/);
        await expect(invoke(fixture.playerActor, fixture)).rejects.toThrow(/FORBIDDEN/);
        await expect(invoke(fixture.crossTenantOwner, fixture)).rejects.toThrow(/FORBIDDEN/);
      },
    );

    test("a Game Master can create, seed, advance, generate, and score a tournament", async () => {
      const fixture = await seedAuthorizationFixture();

      const created = await fixture.gameMaster.mutation(api.tournaments.createTournament, {
        tenantId: fixture.tenantId,
        name: "GM Cup",
        date: Date.now(),
        format: "round_robin",
      });
      expect(created.success).toBe(true);

      const seeded = await fixture.gameMaster.mutation(api.tournaments.updateTeamSeed, {
        tenantId: fixture.tenantId,
        tournamentId: fixture.tournamentId,
        entrantId: fixture.entrant1Id,
        seed: 3,
      });
      expect(seeded.success).toBe(true);

      const closed = await fixture.gameMaster.mutation(api.tournaments.updateTournamentStatus, {
        tenantId: fixture.tenantId,
        tournamentId: fixture.tournamentId,
        status: "registration_closed",
      });
      expect(closed.success).toBe(true);

      const generated = await fixture.gameMaster.mutation(api.tournaments.generateBracket, {
        tenantId: fixture.tenantId,
        tournamentId: fixture.tournamentId,
      });
      expect(generated.success).toBe(true);

      const generatedMatch = await fixture.base.run(async (ctx) =>
        ctx.db
          .query("tournamentMatches")
          .withIndex("by_tournament", (q) => q.eq("tournamentId", fixture.tournamentId))
          .first(),
      );
      if (!generatedMatch) throw new Error("expected a generated match");

      const scored = await fixture.gameMaster.mutation(api.tournaments.recordTournamentScore, {
        tenantId: fixture.tenantId,
        matchId: generatedMatch._id,
        score1: 11,
        score2: 7,
      });
      expect(scored.success).toBe(true);
    });

    test("public tournament reads return safe projections and hide disabled workspaces", async () => {
      const base = convexTest(schema, modules);
      const tenantId = await seedTenant(base);
      const tournamentId = await base.run(async (ctx) =>
        ctx.db.insert("tournaments", {
          tenantId,
          name: "Public Cup",
          date: Date.now(),
          location: "Center Court",
          status: "live",
          format: "single_elimination",
          createdAt: Date.now(),
        }),
      );
      const p1 = await base.run(async (ctx) =>
        ctx.db.insert("players", {
          tenantId,
          firstName: "Private",
          lastName: "Player",
          email: "private@example.com",
          notes: "never public",
          skillSource: "manual",
          manualSkillLevel: "Novice",
          createdAt: Date.now(),
        }),
      );
      const p2 = await seedPlayer(base, tenantId, "Public");
      await seedEntrant(base, tournamentId, p1, p2, "Public Team");

      const byId = await base.query(api.tournaments.getById, { tournamentId });
      const view = await base.query(api.tournaments.getTournamentView, {
        tenantId,
        tournamentId,
      });

      expect(byId).toMatchObject({ _id: tournamentId, name: "Public Cup" });
      expect(byId).not.toHaveProperty("tenantId");
      expect(byId).not.toHaveProperty("createdAt");
      expect(view?.tournament).not.toHaveProperty("tenantId");
      expect(view?.tournament).not.toHaveProperty("createdAt");
      expect(JSON.stringify(view)).not.toContain("private@example.com");
      expect(JSON.stringify(view)).not.toContain("never public");

      await base.run(async (ctx) => ctx.db.patch(tenantId, { status: "disabled" }));
      expect(await base.query(api.tournaments.getById, { tournamentId })).toBeNull();
      expect(
        await base.query(api.tournaments.getTournamentView, { tenantId, tournamentId }),
      ).toBeNull();
    });
  });
});
