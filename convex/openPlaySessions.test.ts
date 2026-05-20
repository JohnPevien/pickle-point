/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("Open Play Sessions", () => {
  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  async function seedTenant(t: ReturnType<typeof convexTest>) {
    return await t.mutation(api.tenants.seed, {
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

    test("updateSessionStatus transitions session to live", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      await t.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId: sessionId as any,
        status: "live",
      });

      const session = await t.query(api.openPlaySessions.getById, {
        sessionId: sessionId as any,
      });
      expect(session?.status).toBe("live");
    });

    test("updateSessionMatchingMode changes the matching mode", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const sessionId = await createSession(t, tenantId as string);

      await t.mutation(api.openPlaySessions.updateSessionMatchingMode, {
        sessionId: sessionId as any,
        matchingMode: "mixed_doubles",
      });

      const session = await t.query(api.openPlaySessions.getById, {
        sessionId: sessionId as any,
      });
      expect(session?.matchingMode).toBe("mixed_doubles");
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
      count: number = 4
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

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: sessionId as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Not enough players");
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
});
