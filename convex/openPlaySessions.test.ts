/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("Open Play Sessions", () => {
  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  async function seedTenant(t: ReturnType<typeof convexTest>) {
    return await t.mutation(internal.tenants.seed, {
      name: "Test Club",
      contactEmail: "gm@testclub.com",
    });
  }

  async function seedPlayer(
    t: ReturnType<typeof convexTest>,
    tenantId: string,
    override: Partial<{
      firstName: string;
      lastName: string;
      manualSkillLevel: string;
      gender: string;
    }> = {}
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("players", {
        tenantId: tenantId as any,
        firstName: override.firstName ?? "Test",
        lastName: override.lastName ?? "Player",
        skillSource: "manual",
        manualSkillLevel: (override.manualSkillLevel ?? "Novice") as any,
        gender: override.gender,
        createdAt: Date.now(),
      });
    });
  }

  async function createSession(
    t: ReturnType<typeof convexTest>,
    tenantId: string
  ) {
    return await t.mutation(api.openPlaySessions.createSession, {
      tenantId: tenantId as any,
      name: "Friday Night Open Play",
      date: Date.now(),
      matchingMode: "auto_balanced",
    });
  }

  // -------------------------------------------------------------------------
  // Session Lifecycle Tests
  // -------------------------------------------------------------------------
  describe("Session Lifecycle", () => {
    test("createSession creates a session in draft status", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      const session = await t.query(api.openPlaySessions.getById, {
        sessionId: sessionId as any,
      });

      expect(session).not.toBeNull();
      expect(session?.status).toBe("draft");
      expect(session?.name).toBe("Friday Night Open Play");
      expect(session?.matchingMode).toBe("auto_balanced");
    });

    test("createSession rejects blank names", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      const result = await t.mutation(api.openPlaySessions.createSession, {
        tenantId: tenantId as any,
        name: "   ",
        date: Date.now(),
        matchingMode: "auto_balanced",
      });

      expect(result).toMatchObject({
        success: false,
        error: "Session name is required.",
      });
    });

    test("listByTenant returns all sessions for the tenant", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      await createSession(t, tenantId as string);
      await t.mutation(api.openPlaySessions.createSession, {
        tenantId: tenantId as any,
        name: "Saturday Morning Open Play",
        date: Date.now(),
        matchingMode: "skill_separated",
      });

      const sessions = await t.query(api.openPlaySessions.listByTenant, {
        tenantId: tenantId as any,
      });

      expect(sessions).toHaveLength(2);
    });

    test("listByTenant respects the bounded limit", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      for (let index = 0; index < 3; index++) {
        await t.mutation(api.openPlaySessions.createSession, {
          tenantId: tenantId as any,
          name: `Session ${index}`,
          date: Date.now() + index,
          matchingMode: "auto_balanced",
        });
      }

      const sessions = await t.query(api.openPlaySessions.listByTenant, {
        tenantId: tenantId as any,
        limit: 2,
      });

      expect(sessions).toHaveLength(2);
    });

    test("updateSessionStatus transitions session to live", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      const result = await t.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId: sessionId as any,
        status: "live",
      });

      expect(result.success).toBe(true);
      const session = await t.query(api.openPlaySessions.getById, {
        sessionId: sessionId as any,
      });
      expect(session?.status).toBe("live");
    });

    test("updateSessionStatus returns an error for a missing session", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      await t.run(async (ctx) => {
        await ctx.db.delete(sessionId as any);
      });

      const result = await t.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId: sessionId as any,
        status: "live",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    test("updateSessionMatchingMode changes the matching mode", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      const result = await t.mutation(api.openPlaySessions.updateSessionMatchingMode, {
        sessionId: sessionId as any,
        matchingMode: "mixed_doubles",
      });

      expect(result.success).toBe(true);
      const session = await t.query(api.openPlaySessions.getById, {
        sessionId: sessionId as any,
      });
      expect(session?.matchingMode).toBe("mixed_doubles");
    });

    test("updateSessionMatchingMode returns an error for a missing session", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      await t.run(async (ctx) => {
        await ctx.db.delete(sessionId as any);
      });

      const result = await t.mutation(api.openPlaySessions.updateSessionMatchingMode, {
        sessionId: sessionId as any,
        matchingMode: "mixed_doubles",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // -------------------------------------------------------------------------
  // Player Check-in Tests
  // -------------------------------------------------------------------------
  describe("Player Check-in & Queue Management", () => {
    test("checkInPlayer adds an existing player to the queue", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);
      const playerId = await seedPlayer(t, tenantId as string);

      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: playerId as any,
      });

      const sessionPlayers = await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId: sessionId as any }
      );

      expect(sessionPlayers).toHaveLength(1);
      expect(sessionPlayers[0].status).toBe("queued");
      expect(sessionPlayers[0].queuePosition).toBe(1);
    });

    test("checkInPlayer rejects a player that is already checked in", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);
      const playerId = await seedPlayer(t, tenantId as string);

      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: playerId as any,
      });

      const result = await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: playerId as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already checked in");
    });

    test("registerAndCheckInGuest creates a new player and checks them in", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      const result = await t.mutation(
        api.openPlaySessions.registerAndCheckInGuest,
        {
          tenantId: tenantId as any,
          sessionId: sessionId as any,
          firstName: "Jane",
          lastName: "Doe",
          skillTier: "Beginner",
          email: "jane.doe@example.com",
        }
      );

      expect(result.success).toBe(true);
      expect(result.playerId).toBeDefined();

      const players = await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId: sessionId as any,
      });
      expect(players).toHaveLength(1);
      expect(players[0].playerDetails?.firstName).toBe("Jane");
    });

    test("registerAndCheckInGuest rejects a mismatched tenant and session", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const otherTenantId = await t.mutation(internal.tenants.seed, {
        name: "Other Club",
        contactEmail: "other@testclub.com",
      });
      const sessionId = await createSession(t, tenantId as string);

      const result = await t.mutation(
        api.openPlaySessions.registerAndCheckInGuest,
        {
          tenantId: otherTenantId as any,
          sessionId: sessionId as any,
          firstName: "Jane",
          lastName: "Doe",
          skillTier: "Beginner",
          email: "jane.doe@example.com",
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace mismatch/i);
    });

    test("queue positions are sequential for multiple check-ins", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      const player1 = await seedPlayer(t, tenantId as string, { firstName: "P1" });
      const player2 = await seedPlayer(t, tenantId as string, { firstName: "P2" });
      const player3 = await seedPlayer(t, tenantId as string, { firstName: "P3" });

      for (const pid of [player1, player2, player3]) {
        await t.mutation(api.openPlaySessions.checkInPlayer, {
          sessionId: sessionId as any,
          playerId: pid as any,
        });
      }

      const sessionPlayers = await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId: sessionId as any }
      );
      const positions = sessionPlayers
        .map((sp) => sp.queuePosition)
        .sort((a, b) => (a ?? 0) - (b ?? 0));

      expect(positions).toEqual([1, 2, 3]);
    });

    test("failed duplicate guest check-in does not consume a queue position", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      await t.mutation(api.openPlaySessions.registerAndCheckInGuest, {
        tenantId: tenantId as any,
        sessionId: sessionId as any,
        firstName: "Jane",
        lastName: "Doe",
        skillTier: "Beginner",
        email: "jane@example.com",
      });

      const duplicate = await t.mutation(api.openPlaySessions.registerAndCheckInGuest, {
        tenantId: tenantId as any,
        sessionId: sessionId as any,
        firstName: "Jane",
        lastName: "Doe",
        skillTier: "Beginner",
        email: "JANE@example.com",
      });
      expect(duplicate.success).toBe(false);

      const nextPlayer = await seedPlayer(t, tenantId as string, { firstName: "Next" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: nextPlayer as any,
      });

      const players = await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId: sessionId as any,
      });
      const positions = players
        .map((sp) => sp.queuePosition)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(positions).toEqual([1, 2]);
    });

    test("updatePlayerStatus moves player to sitting_out", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);
      const playerId = await seedPlayer(t, tenantId as string);

      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: playerId as any,
      });
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId: sessionId as any,
        playerId: playerId as any,
        status: "sitting_out",
      });

      const players = await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId: sessionId as any,
      });
      expect(players[0].status).toBe("sitting_out");
      expect(players[0].queuePosition).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Match Generation & Scoring Tests
  // -------------------------------------------------------------------------
  describe("Match Generation & Scoring", () => {
    async function setupSessionWithPlayers(
      t: ReturnType<typeof convexTest>,
      count: number = 4,
      makeLive: boolean = true
    ) {
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);
      const players = [];
      const skillLevels = ["Beginner", "Novice", "Low Intermediate", "High Intermediate", "Advanced"];
      for (let i = 0; i < count; i++) {
        const pid = await seedPlayer(t, tenantId as string, {
          firstName: `Player${i + 1}`,
          manualSkillLevel: skillLevels[i % skillLevels.length],
        });
        await t.mutation(api.openPlaySessions.checkInPlayer, {
          sessionId: sessionId as any,
          playerId: pid as any,
        });
        players.push(pid);
      }
      if (makeLive) {
        await t.mutation(api.openPlaySessions.updateSessionStatus, {
          sessionId: sessionId as any,
          status: "live",
        });
      }
      return { tenantId, sessionId, players };
    }

    test("generateMatches fails with fewer than 4 queued players", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);
      const pid1 = await seedPlayer(t, tenantId as string, { firstName: "P1" });
      const pid2 = await seedPlayer(t, tenantId as string, { firstName: "P2" });

      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: pid1 as any,
      });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: pid2 as any,
      });
      await t.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId: sessionId as any,
        status: "live",
      });

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: sessionId as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Not enough players");
    });

    test("generateMatches rejects sessions that are not live", async () => {
      const t = convexTest(schema, modules);
      const { sessionId } = await setupSessionWithPlayers(t, 4, false);

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: sessionId as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/live sessions/i);
    });

    test("generateMatches creates 1 match for 4 queued players", async () => {
      const t = convexTest(schema, modules);
      const { sessionId } = await setupSessionWithPlayers(t, 4);

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: sessionId as any,
      });

      expect(result.success).toBe(true);
      expect((result as any).matches).toHaveLength(1);

      const liveMatches = await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId: sessionId as any,
      });
      expect(liveMatches).toHaveLength(1);
      expect(liveMatches[0].team1).toHaveLength(2);
      expect(liveMatches[0].team2).toHaveLength(2);
    });

    test("generateMatches only assigns players that fit available courts", async () => {
      const t = convexTest(schema, modules);
      const { sessionId } = await setupSessionWithPlayers(t, 20);

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: sessionId as any,
      });

      expect(result.success).toBe(true);
      expect((result as any).matches).toHaveLength(4);

      const sessionPlayers = await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId: sessionId as any }
      );
      expect(sessionPlayers.filter((sp) => sp.status === "playing")).toHaveLength(16);
      expect(sessionPlayers.filter((sp) => sp.status === "queued")).toHaveLength(4);
    });

    test("generateMatches sets player status to 'playing'", async () => {
      const t = convexTest(schema, modules);
      const { sessionId } = await setupSessionWithPlayers(t, 4);

      await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: sessionId as any,
      });

      const sessionPlayers = await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId: sessionId as any }
      );

      const playingPlayers = sessionPlayers.filter((sp) => sp.status === "playing");
      expect(playingPlayers).toHaveLength(4);
    });

    test("recordMatchScore completes match and returns players to queue", async () => {
      const t = convexTest(schema, modules);
      const { sessionId } = await setupSessionWithPlayers(t, 4);

      await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: sessionId as any,
      });

      const liveMatches = await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId: sessionId as any,
      });
      const matchId = liveMatches[0]._id;

      await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 7,
      });

      // Match should be in history
      const history = await t.query(api.openPlaySessions.getMatchHistory, {
        sessionId: sessionId as any,
      });
      expect(history).toHaveLength(1);
      expect(history[0].score1).toBe(11);
      expect(history[0].score2).toBe(7);
      expect(history[0].status).toBe("completed");

      // All 4 players should be back in queue
      const sessionPlayers = await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId: sessionId as any }
      );
      const queued = sessionPlayers.filter((sp) => sp.status === "queued");
      expect(queued).toHaveLength(4);
      expect(queued.map((sp) => sp.queuePosition).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
        5,
        6,
        7,
        8,
      ]);
    });

    test("getLiveMatches returns only active matches", async () => {
      const t = convexTest(schema, modules);
      const { sessionId, players } = await setupSessionWithPlayers(t, 4);

      await t.run(async (ctx) => {
        await ctx.db.insert("sessionMatches", {
          sessionId: sessionId as any,
          team1: [players[0] as any, players[1] as any],
          team2: [players[2] as any, players[3] as any],
          status: "pending",
          createdAt: Date.now(),
        });
        await ctx.db.insert("sessionMatches", {
          sessionId: sessionId as any,
          team1: [players[0] as any, players[2] as any],
          team2: [players[1] as any, players[3] as any],
          status: "in_progress",
          createdAt: Date.now(),
        });
        await ctx.db.insert("sessionMatches", {
          sessionId: sessionId as any,
          team1: [players[0] as any, players[3] as any],
          team2: [players[1] as any, players[2] as any],
          score1: 11,
          score2: 7,
          status: "completed",
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
      });

      const liveMatches = await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId: sessionId as any,
      });

      expect(liveMatches).toHaveLength(2);
      expect(liveMatches.map((match) => match.status).sort()).toEqual(["in_progress", "pending"]);
    });

    test("recordMatchScore rejects tied and negative scores", async () => {
      const t = convexTest(schema, modules);
      const { sessionId } = await setupSessionWithPlayers(t, 4);

      await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: sessionId as any,
      });

      const liveMatches = await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId: sessionId as any,
      });
      const matchId = liveMatches[0]._id;

      const tied = await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 11,
      });
      expect(tied.success).toBe(false);
      expect(tied.error).toMatch(/tied/i);

      const negative = await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId: matchId as any,
        score1: -1,
        score2: 11,
      });
      expect(negative.success).toBe(false);
      expect(negative.error).toMatch(/negative/i);
    });

    test("recordMatchScore cannot be applied to an already completed match", async () => {
      const t = convexTest(schema, modules);
      const { sessionId } = await setupSessionWithPlayers(t, 4);
      await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: sessionId as any,
      });
      const liveMatches = await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId: sessionId as any,
      });
      const matchId = liveMatches[0]._id;

      await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 5,
      });

      const result2 = await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 9,
      });

      expect(result2.success).toBe(false);
      expect(result2.error).toContain("already completed");
    });
  });

  // -------------------------------------------------------------------------
  // Match Adjustment Mutations Tests
  // -------------------------------------------------------------------------
  describe("Match Adjustment Mutations", () => {
    /**
     * Helper: create a live session with 4 players in an active in-progress match.
     * If scored=true, sets score1/score2 on the match document directly.
     */
    async function setupActiveMatch(
      t: ReturnType<typeof convexTest>,
      scored = false
    ) {
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      const pids = await Promise.all(
        ["Alpha", "Beta", "Gamma", "Delta"].map((name) =>
          seedPlayer(t, tenantId as string, { firstName: name })
        )
      );

      for (const pid of pids) {
        await t.mutation(api.openPlaySessions.checkInPlayer, {
          sessionId: sessionId as any,
          playerId: pid as any,
        });
      }

      await t.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId: sessionId as any,
        status: "live",
      });

      // Insert match directly so we control composition
      const matchId = await t.run(async (ctx) => {
        return ctx.db.insert("sessionMatches", {
          sessionId: sessionId as any,
          courtName: "Court 1",
          team1: [pids[0] as any, pids[1] as any],
          team2: [pids[2] as any, pids[3] as any],
          status: "in_progress",
          score1: scored ? 5 : undefined,
          score2: scored ? 3 : undefined,
          createdAt: Date.now(),
        });
      });

      // Mark all four players as "playing"
      for (const pid of pids) {
        await t.mutation(api.openPlaySessions.updatePlayerStatus, {
          sessionId: sessionId as any,
          playerId: pid as any,
          status: "playing",
        });
      }

      return { tenantId, sessionId, pids, matchId };
    }

    // --- updateMatchCourt ---

    test("updateMatchCourt renames an active match court", async () => {
      const t = convexTest(schema, modules);
      const { matchId } = await setupActiveMatch(t);

      const result = await t.mutation(api.openPlaySessions.updateMatchCourt, {
        matchId: matchId as any,
        courtName: "Center Court",
      });

      expect(result.success).toBe(true);
      const match = await t.run(async (ctx) => ctx.db.get(matchId as Id<"sessionMatches">));
      expect(match?.courtName).toBe("Center Court");
    });

    test("updateMatchCourt rejects renaming a completed match", async () => {
      const t = convexTest(schema, modules);
      const { sessionId } = await setupActiveMatch(t);

      const live = await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId: sessionId as any,
      });
      const matchId = live[0]._id;

      await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 5,
      });

      const result = await t.mutation(api.openPlaySessions.updateMatchCourt, {
        matchId: matchId as any,
        courtName: "VIP Court",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/completed/i);
    });

    // --- cancelMatch ---

    test("cancelMatch hides the match from getLiveMatches", async () => {
      const t = convexTest(schema, modules);
      const { matchId, sessionId } = await setupActiveMatch(t);

      const result = await t.mutation(api.openPlaySessions.cancelMatch, {
        matchId: matchId as any,
      });

      expect(result.success).toBe(true);

      const liveMatches = await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId: sessionId as any,
      });
      expect(liveMatches).toHaveLength(0);
    });

    test("cancelMatch returns players ahead of the existing queue", async () => {
      const t = convexTest(schema, modules);
      const { matchId, sessionId, pids, tenantId } = await setupActiveMatch(t);

      // Add a 5th player who should stay at the back of the queue
      const pid5 = await seedPlayer(t, tenantId as string, { firstName: "Later" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: pid5 as any,
      });

      // Cancel the match — 4 players should return to front
      await t.mutation(api.openPlaySessions.cancelMatch, {
        matchId: matchId as any,
      });

      const sessionPlayers = await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId: sessionId as any,
      });

      // All 4 cancelled players should be queued
      const cancelledPlayerIds = new Set(pids.map(String));
      const returnedPlayers = sessionPlayers.filter(
        (sp) => cancelledPlayerIds.has(sp.playerId) && sp.status === "queued"
      );
      expect(returnedPlayers).toHaveLength(4);

      // 5th player's position should be greater (behind) all cancelled players
      const pid5Sp = sessionPlayers.find((sp) => sp.playerId === pid5);
      const maxCancelledPos = Math.max(...returnedPlayers.map((sp) => sp.queuePosition ?? 0));
      expect((pid5Sp?.queuePosition ?? 0)).toBeGreaterThan(maxCancelledPos);
    });

    test("cancelMatch rejects a completed match", async () => {
      const t = convexTest(schema, modules);
      const { sessionId } = await setupActiveMatch(t);

      const live = await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId: sessionId as any,
      });
      const matchId = live[0]._id;

      await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId: matchId as any,
        score1: 11,
        score2: 5,
      });

      const result = await t.mutation(api.openPlaySessions.cancelMatch, {
        matchId: matchId as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/completed/i);
    });

    test("cancelMatch rejects a match with scores already recorded", async () => {
      const t = convexTest(schema, modules);
      const { matchId } = await setupActiveMatch(t, true); // scored=true

      const result = await t.mutation(api.openPlaySessions.cancelMatch, {
        matchId: matchId as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/scores/i);
    });

    // --- swapMatchPlayers ---

    test("swapMatchPlayers produces 4 unique players after swap", async () => {
      const t = convexTest(schema, modules);
      const { matchId, sessionId, pids } = await setupActiveMatch(t);

      // Swap pids[0] (team1) with pids[2] (team2)
      const result = await t.mutation(api.openPlaySessions.swapMatchPlayers, {
        matchId: matchId as any,
        playerAId: pids[0] as any,
        playerBId: pids[2] as any,
      });

      expect(result.success).toBe(true);

      const liveMatches = await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId: sessionId as any,
      });
      const match = liveMatches[0];
      const allIds = [...match.team1, ...match.team2];
      expect(new Set(allIds).size).toBe(4);
      expect(match.team1).toContain(pids[2]);
      expect(match.team2).toContain(pids[0]);
    });

    test("swapMatchPlayers rejects a player not in the match", async () => {
      const t = convexTest(schema, modules);
      const { matchId, pids, tenantId } = await setupActiveMatch(t);

      const outsider = await seedPlayer(t, tenantId as string, { firstName: "Outside" });

      const result = await t.mutation(api.openPlaySessions.swapMatchPlayers, {
        matchId: matchId as any,
        playerAId: outsider as any,
        playerBId: pids[0] as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not in this match/i);
    });

    test("swapMatchPlayers rejects swapping a player with themselves", async () => {
      const t = convexTest(schema, modules);
      const { matchId, pids } = await setupActiveMatch(t);

      const result = await t.mutation(api.openPlaySessions.swapMatchPlayers, {
        matchId: matchId as any,
        playerAId: pids[0] as any,
        playerBId: pids[0] as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/themselves/i);
    });

    // --- substituteMatchPlayer ---

    test("substituteMatchPlayer with queued player succeeds", async () => {
      const t = convexTest(schema, modules);
      const { matchId, sessionId, pids, tenantId } = await setupActiveMatch(t);

      const pid5 = await seedPlayer(t, tenantId as string, { firstName: "Sub" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: pid5 as any,
      });

      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId: matchId as any,
        outgoingPlayerId: pids[0] as any,
        incomingPlayerId: pid5 as any,
      });

      expect(result.success).toBe(true);

      const sessionPlayers = await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId: sessionId as any,
      });

      const incomingSP = sessionPlayers.find((sp) => sp.playerId === pid5);
      const outgoingSP = sessionPlayers.find((sp) => sp.playerId === pids[0]);

      expect(incomingSP?.status).toBe("playing");
      expect(outgoingSP?.status).toBe("queued");
    });

    test("substituteMatchPlayer with sitting_out player succeeds", async () => {
      const t = convexTest(schema, modules);
      const { matchId, sessionId, pids, tenantId } = await setupActiveMatch(t);

      const pid5 = await seedPlayer(t, tenantId as string, { firstName: "Sitter" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: pid5 as any,
      });
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId: sessionId as any,
        playerId: pid5 as any,
        status: "sitting_out",
      });

      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId: matchId as any,
        outgoingPlayerId: pids[1] as any,
        incomingPlayerId: pid5 as any,
      });

      expect(result.success).toBe(true);

      const sessionPlayers = await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId: sessionId as any,
      });
      const incomingSP = sessionPlayers.find((sp) => sp.playerId === pid5);
      expect(incomingSP?.status).toBe("playing");
    });

    test("substituteMatchPlayer rejects incoming player not in session", async () => {
      const t = convexTest(schema, modules);
      const { matchId, pids, tenantId } = await setupActiveMatch(t);

      const outsider = await seedPlayer(t, tenantId as string, { firstName: "Stranger" });

      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId: matchId as any,
        outgoingPlayerId: pids[0] as any,
        incomingPlayerId: outsider as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not checked into/i);
    });

    test("substituteMatchPlayer rejects incoming player who is already playing", async () => {
      const t = convexTest(schema, modules);
      const { matchId, pids } = await setupActiveMatch(t);

      // pids[3] is already in the match and marked "playing"
      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId: matchId as any,
        outgoingPlayerId: pids[0] as any,
        incomingPlayerId: pids[3] as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/queued or sitting out/i);
    });

    test("substituteMatchPlayer is blocked after scores are recorded", async () => {
      const t = convexTest(schema, modules);
      const { matchId, sessionId, pids, tenantId } = await setupActiveMatch(t, true);

      const pid5 = await seedPlayer(t, tenantId as string, { firstName: "Late" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: sessionId as any,
        playerId: pid5 as any,
      });

      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId: matchId as any,
        outgoingPlayerId: pids[0] as any,
        incomingPlayerId: pid5 as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/scoring/i);
    });

    test("returning from sitting_out appends player to back of queue", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      const [p1, p2, p3] = await Promise.all([
        seedPlayer(t, tenantId as string, { firstName: "P1" }),
        seedPlayer(t, tenantId as string, { firstName: "P2" }),
        seedPlayer(t, tenantId as string, { firstName: "P3" }),
      ]);

      for (const pid of [p1, p2, p3]) {
        await t.mutation(api.openPlaySessions.checkInPlayer, {
          sessionId: sessionId as any,
          playerId: pid as any,
        });
      }

      // Move p1 to sitting_out then return to queue
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId: sessionId as any,
        playerId: p1 as any,
        status: "sitting_out",
      });
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId: sessionId as any,
        playerId: p1 as any,
        status: "queued",
      });

      const sessionPlayers = await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId: sessionId as any,
      });

      const p1SP = sessionPlayers.find((sp) => sp.playerId === p1);
      const p2SP = sessionPlayers.find((sp) => sp.playerId === p2);
      const p3SP = sessionPlayers.find((sp) => sp.playerId === p3);

      // p1 re-queued should be behind p2 and p3
      expect((p1SP?.queuePosition ?? 0)).toBeGreaterThan(p2SP?.queuePosition ?? 0);
      expect((p1SP?.queuePosition ?? 0)).toBeGreaterThan(p3SP?.queuePosition ?? 0);
    });
  });
});
