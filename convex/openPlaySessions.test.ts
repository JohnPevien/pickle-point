/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest, type TestConvex } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// Schema-aware test instance produced by `convexTest(schema, modules)`.
// We derive the type from `typeof schema` (not `ReturnType<typeof
// convexTest>`, which collapses to the `GenericSchema` overload and loses
// index typing inside `t.run`). Helpers accept/return this type so
// `ctx.db.query(...).withIndex(...)` keeps its schema-aware typing.
type TestInstance = TestConvex<typeof schema>;

// -------------------------------------------------------------------------
// Module-scope shared helpers (used by every describe block below).
//
// Phase 3.3 hardened the open-play queries/mutations behind `requireRole`,
// so tests must drive them through an authenticated identity. The admin
// path additionally validates trusted WorkOS JWT claims (issuer,
// organization id, role) via `convex/lib/authz.ts#validateWorkOSClaim`,
// so the seeded identity and membership must carry matching claims — a
// bare `tokenIdentifier` is not enough for owner/game_master surfaces.
// -------------------------------------------------------------------------

const ADMIN_TOKEN = "admin_token";
const WORKOS_ISSUER = "https://api.workos.com";

/**
 * Seed a tenant and an owner identity for it, returning the tenant id and
 * an `asAdmin` wrapper that attaches a fully-formed admin identity (issuer
 * + organization id + role claims) satisfying `requireRole`'s WorkOS claim
 * check. The tenant's `workosOrganizationId` (set by `internal.tenants.seed`)
 * is read back so the identity's `organization_id` claim always matches.
 *
 * `withIdentity` returns a narrower convex-test type than the original
 * instance; we re-widen it to `TestInstance` at this single, documented
 * boundary so the schema-aware `t.run`/`query`/`mutation` typing is
 * preserved for every caller without scattering casts.
 */
async function seedTenantAuth(t: TestInstance): Promise<{
  tenantId: Id<"tenants">;
  asAdmin: (instance?: TestInstance) => TestInstance;
}> {
  const tenantId = await seedTenant(t);
  const { workosOrganizationId } = await t.run(async (ctx) => {
    const tenant = await ctx.db.get(tenantId);
    if (!tenant?.workosOrganizationId) {
      throw new Error("seeded tenant is missing workosOrganizationId");
    }
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: ADMIN_TOKEN,
      email: "admin@testclub.com",
      tenantId,
      createdAt: Date.now(),
    });
    const now = Date.now();
    await ctx.db.insert("tenantMemberships", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      workosOrganizationMembershipId: `mem_${ADMIN_TOKEN}`,
      createdAt: now,
      updatedAt: now,
    });
    return { workosOrganizationId: tenant.workosOrganizationId };
  });

  const adminIdentity = {
    tokenIdentifier: ADMIN_TOKEN,
    issuer: WORKOS_ISSUER,
    organization_id: workosOrganizationId,
    role: "owner",
  };
  return {
    tenantId,
    asAdmin: (instance: TestInstance = t) =>
      instance.withIdentity(adminIdentity) as unknown as TestInstance,
  };
}

async function seedTenant(t: TestInstance) {
  return await t.mutation(internal.tenants.seed, {
    name: "Test Club",
    contactEmail: "gm@testclub.com",
  });
}

async function seedPlayer(
  t: TestInstance,
  tenantId: Id<"tenants">,
  override: Partial<{
    firstName: string;
    lastName: string;
    manualSkillLevel: string;
    gender: string;
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("players", {
      tenantId,
      firstName: override.firstName ?? "Test",
      lastName: override.lastName ?? "Player",
      skillSource: "manual",
      manualSkillLevel: (override.manualSkillLevel ?? "Novice") as any,
      gender: override.gender,
      createdAt: Date.now(),
    });
  });
}

/**
 * Create a session via the public mutation. The mutation returns either the
 * new session id or `{ success: false, error }`; in the test flow we always
 * expect success, so a failure is converted to a thrown error (keeping the
 * return type a plain `Id<"openPlaySessions">` for ergonomic chaining).
 */
async function createSession(t: TestInstance, tenantId: Id<"tenants">): Promise<Id<"openPlaySessions">> {
  const result = await t.mutation(api.openPlaySessions.createSession, {
    tenantId,
    name: "Friday Night Open Play",
    date: Date.now(),
    matchingMode: "auto_balanced",
  });
  if (typeof result !== "string") {
    throw new Error(`createSession failed: ${result.error}`);
  }
  return result as Id<"openPlaySessions">;
}

async function seedRoleActor(
  t: TestInstance,
  tenantId: Id<"tenants">,
  role: "owner" | "game_master" | "player",
  tokenIdentifier: string,
): Promise<TestInstance> {
  const workosOrganizationId = await t.run(async (ctx) => {
    const tenant = await ctx.db.get(tenantId);
    if (!tenant?.workosOrganizationId) {
      throw new Error("seeded tenant is missing workosOrganizationId");
    }
    const userId = await ctx.db.insert("users", {
      tokenIdentifier,
      email: `${tokenIdentifier}@testclub.com`,
      tenantId,
      createdAt: Date.now(),
    });
    const now = Date.now();
    await ctx.db.insert("tenantMemberships", {
      tenantId,
      userId,
      role,
      status: "active",
      workosOrganizationMembershipId: `mem_${tokenIdentifier}`,
      createdAt: now,
      updatedAt: now,
    });
    return tenant.workosOrganizationId;
  });

  return t.withIdentity({
    tokenIdentifier,
    issuer: WORKOS_ISSUER,
    organization_id: workosOrganizationId,
    role,
  }) as unknown as TestInstance;
}

async function seedOperationAuthorizationFixture() {
  const base = convexTest(schema, modules);
  const { tenantId, asAdmin } = await seedTenantAuth(base);
  const owner = asAdmin();
  const gameMaster = await seedRoleActor(base, tenantId, "game_master", "gm_token");
  const playerActor = await seedRoleActor(base, tenantId, "player", "player_token");

  const otherTenantId = await base.run(async (ctx) =>
    ctx.db.insert("tenants", {
      name: "Other Test Club",
      contactEmail: "other@testclub.com",
      slug: "other-test-club",
      timezone: "Asia/Manila",
      workosOrganizationId: "org_other_test_club",
      status: "active",
      createdAt: Date.now(),
    }),
  );
  const crossTenantOwner = await seedRoleActor(
    base,
    otherTenantId,
    "owner",
    "other_owner_token",
  );

  const sessionId = await createSession(owner, tenantId);
  await owner.mutation(api.openPlaySessions.updateSessionStatus, {
    sessionId,
    status: "live",
  });

  const playerIds: Id<"players">[] = [];
  for (let index = 0; index < 6; index++) {
    playerIds.push(
      await seedPlayer(base, tenantId, {
        firstName: `Auth${index}`,
      }),
    );
  }
  for (const playerId of playerIds.slice(0, 5)) {
    await owner.mutation(api.openPlaySessions.checkInPlayer, { sessionId, playerId });
  }

  const generated = await owner.mutation(api.openPlaySessions.generateMatches, { sessionId });
  if (!generated.success) throw new Error("match generation failed");
  const activeMatches = (
    await owner.query(api.openPlaySessions.getLiveMatches, { sessionId })
  ).entries;
  const match = activeMatches[0];
  if (!match) throw new Error("expected an active match");

  return {
    base,
    owner,
    gameMaster,
    playerActor,
    crossTenantOwner,
    tenantId,
    sessionId,
    match,
    sparePlayerId: playerIds[4],
    uncheckedPlayerId: playerIds[5],
  };
}

type OperationAuthorizationFixture = Awaited<
  ReturnType<typeof seedOperationAuthorizationFixture>
>;

const protectedOperationCases = [
  {
    name: "checkInPlayer",
    invoke: (t: TestInstance, fixture: OperationAuthorizationFixture) =>
      t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId: fixture.sessionId,
        playerId: fixture.uncheckedPlayerId,
      }),
  },
  {
    name: "registerAndCheckInGuest",
    invoke: (t: TestInstance, fixture: OperationAuthorizationFixture) =>
      t.mutation(api.openPlaySessions.registerAndCheckInGuest, {
        tenantId: fixture.tenantId,
        sessionId: fixture.sessionId,
        firstName: "Walk",
        lastName: "In",
        skillTier: "Beginner",
      }),
  },
  {
    name: "updatePlayerStatus",
    invoke: (t: TestInstance, fixture: OperationAuthorizationFixture) =>
      t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId: fixture.sessionId,
        playerId: fixture.match.team1[0],
        status: "paused",
      }),
  },
  {
    name: "generateMatches",
    invoke: (t: TestInstance, fixture: OperationAuthorizationFixture) =>
      t.mutation(api.openPlaySessions.generateMatches, {
        sessionId: fixture.sessionId,
      }),
  },
  {
    name: "recordMatchScore",
    invoke: (t: TestInstance, fixture: OperationAuthorizationFixture) =>
      t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId: fixture.match._id,
        score1: 11,
        score2: 7,
      }),
  },
  {
    name: "updateMatchCourt",
    invoke: (t: TestInstance, fixture: OperationAuthorizationFixture) =>
      t.mutation(api.openPlaySessions.updateMatchCourt, {
        matchId: fixture.match._id,
        courtName: "Championship Court",
      }),
  },
  {
    name: "swapMatchPlayers",
    invoke: (t: TestInstance, fixture: OperationAuthorizationFixture) =>
      t.mutation(api.openPlaySessions.swapMatchPlayers, {
        matchId: fixture.match._id,
        playerAId: fixture.match.team1[0],
        playerBId: fixture.match.team2[0],
      }),
  },
  {
    name: "substituteMatchPlayer",
    invoke: (t: TestInstance, fixture: OperationAuthorizationFixture) =>
      t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId: fixture.match._id,
        outgoingPlayerId: fixture.match.team1[0],
        incomingPlayerId: fixture.sparePlayerId,
      }),
  },
  {
    name: "cancelMatch",
    invoke: (t: TestInstance, fixture: OperationAuthorizationFixture) =>
      t.mutation(api.openPlaySessions.cancelMatch, {
        matchId: fixture.match._id,
      }),
  },
] as const;

describe("Open Play Sessions", () => {
  // -------------------------------------------------------------------------
  // Session Lifecycle Tests
  // -------------------------------------------------------------------------
  describe("Session Lifecycle", () => {
    test("createSession creates a session in draft status", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      const session = await t.query(api.openPlaySessions.getById, {
        sessionId,
      });

      expect(session).not.toBeNull();
      expect(session?.status).toBe("draft");
      expect(session?.name).toBe("Friday Night Open Play");
      expect(session?.matchingMode).toBe("auto_balanced");
    });

    test("createSession rejects blank names", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();

      const result = await t.mutation(api.openPlaySessions.createSession, {
        tenantId,
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
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      await createSession(t, tenantId);
      await t.mutation(api.openPlaySessions.createSession, {
        tenantId,
        name: "Saturday Morning Open Play",
        date: Date.now(),
        matchingMode: "skill_separated",
      });

      const sessions = await t.query(api.openPlaySessions.listByTenant, {
        tenantId,
      });

      expect(sessions).toHaveLength(2);
    });

    test("listByTenant respects the bounded limit", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();

      for (let index = 0; index < 3; index++) {
        await t.mutation(api.openPlaySessions.createSession, {
          tenantId,
          name: `Session ${index}`,
          date: Date.now() + index,
          matchingMode: "auto_balanced",
        });
      }

      const sessions = await t.query(api.openPlaySessions.listByTenant, {
        tenantId,
        limit: 2,
      });

      expect(sessions).toHaveLength(2);
      expect(sessions.map((session) => session.name)).toEqual([
        "Session 2",
        "Session 1",
      ]);
    });

    test("updateSessionStatus transitions session to live", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      const result = await t.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId,
        status: "live",
      });

      expect(result.success).toBe(true);
      const session = await t.query(api.openPlaySessions.getById, {
        sessionId,
      });
      expect(session?.status).toBe("live");
    });

    test("updateSessionStatus returns an error for a missing session", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(sessionId as any);
      });

      const result = await t.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId,
        status: "live",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    test("updateSessionMatchingMode changes the matching mode", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      const result = await t.mutation(api.openPlaySessions.updateSessionMatchingMode, {
        sessionId,
        matchingMode: "mixed_doubles",
      });

      expect(result.success).toBe(true);
      const session = await t.query(api.openPlaySessions.getById, {
        sessionId,
      });
      expect(session?.matchingMode).toBe("mixed_doubles");
    });

    test("updateSessionMatchingMode returns an error for a missing session", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(sessionId as any);
      });

      const result = await t.mutation(api.openPlaySessions.updateSessionMatchingMode, {
        sessionId,
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
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);
      const playerId = await seedPlayer(t, tenantId);

      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId,
      });

      const sessionPlayers = (await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId }
      )).entries;

      expect(sessionPlayers).toHaveLength(1);
      expect(sessionPlayers[0].status).toBe("queued");
      expect(sessionPlayers[0].queuePosition).toBe(1);
    });

    test("checkInPlayer rejects a player that is already checked in", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);
      const playerId = await seedPlayer(t, tenantId);

      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId,
      });

      const result = await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already checked in");
    });

    test("registerAndCheckInGuest creates a new player and checks them in", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      const result = await t.mutation(
        api.openPlaySessions.registerAndCheckInGuest,
        {
          tenantId,
          sessionId,
          firstName: "Jane",
          lastName: "Doe",
          skillTier: "Beginner",
          email: "jane.doe@example.com",
        }
      );

      expect(result.success).toBe(true);
      expect(result.playerId).toBeDefined();

      const players = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;
      expect(players).toHaveLength(1);
      expect(players[0].playerDetails?.firstName).toBe("Jane");
    });

    test("registerAndCheckInGuest rejects a mismatched tenant and session", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const otherTenantId = await t.mutation(internal.tenants.seed, {
        name: "Other Club",
        contactEmail: "other@testclub.com",
      });
      const sessionId = await createSession(t, tenantId);

      const result = await t.mutation(
        api.openPlaySessions.registerAndCheckInGuest,
        {
          tenantId: otherTenantId as any,
          sessionId,
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
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      const player1 = await seedPlayer(t, tenantId, { firstName: "P1" });
      const player2 = await seedPlayer(t, tenantId, { firstName: "P2" });
      const player3 = await seedPlayer(t, tenantId, { firstName: "P3" });

      for (const pid of [player1, player2, player3]) {
        await t.mutation(api.openPlaySessions.checkInPlayer, {
          sessionId,
          playerId: pid,
        });
      }

      const sessionPlayers = (await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId }
      )).entries;
      const positions = sessionPlayers
        .map((sp) => sp.queuePosition)
        .sort((a, b) => (a ?? 0) - (b ?? 0));

      expect(positions).toEqual([1, 2, 3]);
    });

    test("failed duplicate guest check-in does not consume a queue position", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      await t.mutation(api.openPlaySessions.registerAndCheckInGuest, {
        tenantId,
        sessionId,
        firstName: "Jane",
        lastName: "Doe",
        skillTier: "Beginner",
        email: "jane@example.com",
      });

      const duplicate = await t.mutation(api.openPlaySessions.registerAndCheckInGuest, {
        tenantId,
        sessionId,
        firstName: "Jane",
        lastName: "Doe",
        skillTier: "Beginner",
        email: "JANE@example.com",
      });
      expect(duplicate.success).toBe(false);

      const nextPlayer = await seedPlayer(t, tenantId, { firstName: "Next" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId: nextPlayer as any,
      });

      const players = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;
      const positions = players
        .map((sp) => sp.queuePosition)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(positions).toEqual([1, 2]);
    });

    test("updatePlayerStatus moves player to sitting_out", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);
      const playerId = await seedPlayer(t, tenantId);

      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId,
      });
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId,
        playerId,
        status: "sitting_out",
      });

      const players = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;
      expect(players[0].status).toBe("sitting_out");
      expect(players[0].queuePosition).toBe(1);
      expect(players[0].sitOutCount).toBe(1);
      expect(players[0].consecutiveSitOuts).toBe(1);
      expect(players[0].lastSatOutAt).toEqual(expect.any(Number));
    });

    test("updatePlayerStatus can pause and resume a player", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);
      const playerId = await seedPlayer(t, tenantId);

      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId,
      });
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId,
        playerId,
        status: "paused",
      });

      let players = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;
      expect(players[0].status).toBe("paused");
      expect(players[0].queuePosition).toBeUndefined();
      expect(players[0].sitOutCount).toBe(0);

      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId,
        playerId,
        status: "queued",
      });

      players = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;
      expect(players[0].status).toBe("queued");
      expect(players[0].queuePosition).toEqual(expect.any(Number));
    });
  });

  // -------------------------------------------------------------------------
  // Match Generation & Scoring Tests
  // -------------------------------------------------------------------------
  describe("Match Generation & Scoring", () => {
    async function setupSessionWithPlayers(
      base: TestInstance,
      count: number = 4,
      makeLive: boolean = true
    ) {
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);
      const players = [];
      const skillLevels = ["Beginner", "Novice", "Low Intermediate", "High Intermediate", "Advanced"];
      for (let i = 0; i < count; i++) {
        const pid = await seedPlayer(t, tenantId, {
          firstName: `Player${i + 1}`,
          manualSkillLevel: skillLevels[i % skillLevels.length],
        });
        await t.mutation(api.openPlaySessions.checkInPlayer, {
          sessionId,
          playerId: pid,
        });
        players.push(pid);
      }
      if (makeLive) {
        await t.mutation(api.openPlaySessions.updateSessionStatus, {
          sessionId,
          status: "live",
        });
      }
      return { t, tenantId, sessionId, players };
    }

    test("generateMatches fails with fewer than 4 queued players", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);
      const pid1 = await seedPlayer(t, tenantId, { firstName: "P1" });
      const pid2 = await seedPlayer(t, tenantId, { firstName: "P2" });

      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId: pid1 as any,
      });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId: pid2 as any,
      });
      await t.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId,
        status: "live",
      });

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Not enough players");
    });

    test("generateMatches rejects sessions that are not live", async () => {
      const base = convexTest(schema, modules);
      const { t, sessionId } = await setupSessionWithPlayers(base, 4, false);

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/live sessions/i);
    });

    test("generateMatches creates 1 match for 4 queued players", async () => {
      const base = convexTest(schema, modules);
      const { t, sessionId } = await setupSessionWithPlayers(base, 4);

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });

      expect(result.success).toBe(true);
      expect((result as any).matches).toHaveLength(1);

      const liveMatches = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      expect(liveMatches).toHaveLength(1);
      expect(liveMatches[0].team1).toHaveLength(2);
      expect(liveMatches[0].team2).toHaveLength(2);
    });

    test("generateMatches only assigns players that fit available courts", async () => {
      const base = convexTest(schema, modules);
      const { t, sessionId } = await setupSessionWithPlayers(base, 20);

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });

      expect(result.success).toBe(true);
      expect((result as any).matches).toHaveLength(4);

      const sessionPlayers = (await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId }
      )).entries;
      expect(sessionPlayers.filter((sp) => sp.status === "playing")).toHaveLength(16);
      expect(sessionPlayers.filter((sp) => sp.status === "sitting_out")).toHaveLength(4);
      expect(sessionPlayers.filter((sp) => sp.status === "sitting_out")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sitOutCount: 1,
            consecutiveSitOuts: 1,
            lastSatOutAt: expect.any(Number),
          }),
        ])
      );
    });

    test("generateMatches fills only courts without active matches", async () => {
      const base = convexTest(schema, modules);
      const { t, tenantId, sessionId, players } = await setupSessionWithPlayers(base, 8);

      await t.run(async (ctx) => {
        const venueId = await ctx.db.insert("venues", {
          tenantId,
          name: "Two Court Club",
          courtCount: 2,
          createdAt: Date.now(),
        });
        await ctx.db.patch(sessionId as any, { venueId });
        await ctx.db.insert("sessionMatches", {
          sessionId,
          courtName: "Court 1",
          team1: [players[0] as any, players[1] as any],
          team2: [players[2] as any, players[3] as any],
          status: "in_progress",
          createdAt: Date.now(),
        });

        for (const playerId of players.slice(0, 4)) {
          const sessionPlayer = await ctx.db
            .query("sessionPlayers")
            .withIndex("by_sessionId_and_playerId", (q) =>
              q.eq("sessionId", sessionId as any).eq("playerId", playerId as any)
            )
            .unique();

          if (!sessionPlayer) {
            throw new Error("Expected checked-in player to have a session player row.");
          }

          await ctx.db.patch(sessionPlayer._id, {
            status: "playing",
            queuePosition: undefined,
          });
        }
      });

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });

      expect(result.success).toBe(true);
      expect((result as any).matches).toHaveLength(1);

      const liveMatches = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      expect(liveMatches).toHaveLength(2);

      const generatedMatch = liveMatches.find((match) => match.courtName === "Court 2");
      expect(generatedMatch).toBeDefined();

      const generatedPlayerIds = new Set([
        ...generatedMatch!.team1,
        ...generatedMatch!.team2,
      ].map(String));

      for (const activePlayerId of players.slice(0, 4)) {
        expect(generatedPlayerIds.has(String(activePlayerId))).toBe(false);
      }
    });

    test("generateMatches sets player status to 'playing'", async () => {
      const base = convexTest(schema, modules);
      const { t, sessionId } = await setupSessionWithPlayers(base, 4);

      await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });

      const sessionPlayers = (await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId }
      )).entries;

      const playingPlayers = sessionPlayers.filter((sp) => sp.status === "playing");
      expect(playingPlayers).toHaveLength(4);
      expect(playingPlayers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            matchesPlayed: 1,
            consecutiveSitOuts: 0,
            lastPlayedAt: expect.any(Number),
          }),
        ])
      );
    });

    test("generateMatches prioritizes consecutive sit-outs, sit-out count, last played, then queue position", async () => {
      const base = convexTest(schema, modules);
      const { t, tenantId, sessionId, players } = await setupSessionWithPlayers(base, 8);

      const venueId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("venues", {
          tenantId,
          name: "One Court Club",
          courtCount: 1,
          createdAt: Date.now(),
        });
        await ctx.db.patch(sessionId as any, { venueId: id });
        return id;
      });
      expect(venueId).toBeDefined();

      await t.run(async (ctx) => {
        const metadata = [
          { consecutiveSitOuts: 0, sitOutCount: 0, lastPlayedAt: 100 },
          { consecutiveSitOuts: 2, sitOutCount: 2, lastPlayedAt: 500 },
          { consecutiveSitOuts: 1, sitOutCount: 5, lastPlayedAt: 400 },
          { consecutiveSitOuts: 1, sitOutCount: 4, lastPlayedAt: 50 },
          { consecutiveSitOuts: 0, sitOutCount: 10, lastPlayedAt: 300 },
          { consecutiveSitOuts: 0, sitOutCount: 0 },
          { consecutiveSitOuts: 0, sitOutCount: 0, lastPlayedAt: 10 },
          { consecutiveSitOuts: 0, sitOutCount: 0, lastPlayedAt: 20 },
        ];

        for (let index = 0; index < players.length; index++) {
          const sp = await ctx.db
            .query("sessionPlayers")
            .withIndex("by_sessionId_and_playerId", (q) =>
              q.eq("sessionId", sessionId as any).eq("playerId", players[index] as any)
            )
            .first();
          if (!sp) throw new Error("Missing session player");
          await ctx.db.patch(sp._id, metadata[index]);
        }
      });

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });
      expect(result.success).toBe(true);

      const live = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      expect(live).toHaveLength(1);
      const match = live[0];
      const selectedPlayerIds = new Set([...match.team1, ...match.team2].map(String));
      expect(selectedPlayerIds).toEqual(
        new Set([players[1], players[2], players[3], players[4]].map(String))
      );
    });

    test("generateMatches excludes paused players", async () => {
      const base = convexTest(schema, modules);
      const { t, tenantId, sessionId, players } = await setupSessionWithPlayers(base, 5);

      await t.run(async (ctx) => {
        const venueId = await ctx.db.insert("venues", {
          tenantId,
          name: "One Court Club",
          courtCount: 1,
          createdAt: Date.now(),
        });
        await ctx.db.patch(sessionId as any, { venueId });
      });
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId,
        playerId: players[1] as any,
        status: "paused",
      });

      const result = await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });
      expect(result.success).toBe(true);

      const live = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      expect(live).toHaveLength(1);
      const match = live[0];
      const selectedPlayerIds = new Set([...match.team1, ...match.team2].map(String));
      expect(selectedPlayerIds.has(String(players[1]))).toBe(false);

      const sessionPlayers = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;
      const paused = sessionPlayers.find((sp) => sp.playerId === players[1]);
      expect(paused).toMatchObject({
        status: "paused",
        sitOutCount: 0,
      });
    });

    test("recordMatchScore completes match and returns players to queue", async () => {
      const base = convexTest(schema, modules);
      const { t, sessionId } = await setupSessionWithPlayers(base, 4);

      await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });

      const liveMatches = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      const matchId = liveMatches[0]._id;

      await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId,
        score1: 11,
        score2: 7,
      });

      // Match should be in history
      const history = (await t.query(api.openPlaySessions.getMatchHistory, {
        sessionId,
      })).entries;
      expect(history).toHaveLength(1);
      expect(history[0].score1).toBe(11);
      expect(history[0].score2).toBe(7);
      expect(history[0].status).toBe("completed");

      // All 4 players should be back in queue
      const sessionPlayers = (await t.query(
        api.openPlaySessions.getSessionPlayers,
        { sessionId }
      )).entries;
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
      const base = convexTest(schema, modules);
      const { t, sessionId, players } = await setupSessionWithPlayers(base, 4);

      await t.run(async (ctx) => {
        await ctx.db.insert("sessionMatches", {
          sessionId,
          team1: [players[0] as any, players[1] as any],
          team2: [players[2] as any, players[3] as any],
          status: "pending",
          createdAt: Date.now(),
        });
        await ctx.db.insert("sessionMatches", {
          sessionId,
          team1: [players[0] as any, players[2] as any],
          team2: [players[1] as any, players[3] as any],
          status: "in_progress",
          createdAt: Date.now(),
        });
        await ctx.db.insert("sessionMatches", {
          sessionId,
          team1: [players[0] as any, players[3] as any],
          team2: [players[1] as any, players[2] as any],
          score1: 11,
          score2: 7,
          status: "completed",
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
      });

      const liveMatches = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;

      expect(liveMatches).toHaveLength(2);
      expect(liveMatches.map((match) => match.status).sort()).toEqual(["in_progress", "pending"]);
    });

    test("recordMatchScore rejects tied and negative scores", async () => {
      const base = convexTest(schema, modules);
      const { t, sessionId } = await setupSessionWithPlayers(base, 4);

      await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });

      const liveMatches = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      const matchId = liveMatches[0]._id;

      const tied = await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId,
        score1: 11,
        score2: 11,
      });
      expect(tied.success).toBe(false);
      expect(tied.error).toMatch(/tied/i);

      const negative = await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId,
        score1: -1,
        score2: 11,
      });
      expect(negative.success).toBe(false);
      expect(negative.error).toMatch(/negative/i);
    });

    test("recordMatchScore cannot be applied to an already completed match", async () => {
      const base = convexTest(schema, modules);
      const { t, sessionId } = await setupSessionWithPlayers(base, 4);
      await t.mutation(api.openPlaySessions.generateMatches, {
        sessionId,
      });
      const liveMatches = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      const matchId = liveMatches[0]._id;

      await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId,
        score1: 11,
        score2: 5,
      });

      const result2 = await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId,
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
      base: TestInstance,
      scored = false
    ) {
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      const pids = await Promise.all(
        ["Alpha", "Beta", "Gamma", "Delta"].map((name) =>
          seedPlayer(t, tenantId, { firstName: name })
        )
      );

      for (const pid of pids) {
        await t.mutation(api.openPlaySessions.checkInPlayer, {
          sessionId,
          playerId: pid,
        });
      }

      await t.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId,
        status: "live",
      });

      // Insert match directly so we control composition
      const matchId = await t.run(async (ctx) => {
        return ctx.db.insert("sessionMatches", {
          sessionId,
          courtName: "Court 1",
          team1: [pids[0], pids[1]],
          team2: [pids[2], pids[3]],
          status: "in_progress",
          score1: scored ? 5 : undefined,
          score2: scored ? 3 : undefined,
          createdAt: Date.now(),
        });
      });

      // Mark all four players as "playing"
      for (const pid of pids) {
        await t.mutation(api.openPlaySessions.updatePlayerStatus, {
          sessionId,
          playerId: pid,
          status: "playing",
        });
      }

      return { t, tenantId, sessionId, pids, matchId };
    }

    // --- updateMatchCourt ---

    test("updateMatchCourt renames an active match court", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId } = await setupActiveMatch(base);

      const result = await t.mutation(api.openPlaySessions.updateMatchCourt, {
        matchId,
        courtName: "Center Court",
      });

      expect(result.success).toBe(true);
      const match = await t.run(async (ctx) => ctx.db.get(matchId as Id<"sessionMatches">));
      expect(match?.courtName).toBe("Center Court");
    });

    test("updateMatchCourt rejects renaming a completed match", async () => {
      const base = convexTest(schema, modules);
      const { t, sessionId } = await setupActiveMatch(base);

      const live = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      const matchId = live[0]._id;

      await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId,
        score1: 11,
        score2: 5,
      });

      const result = await t.mutation(api.openPlaySessions.updateMatchCourt, {
        matchId,
        courtName: "VIP Court",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/completed/i);
    });

    // --- cancelMatch ---

    test("cancelMatch hides the match from getLiveMatches", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, sessionId } = await setupActiveMatch(base);

      const result = await t.mutation(api.openPlaySessions.cancelMatch, {
        matchId,
      });

      expect(result.success).toBe(true);

      const liveMatches = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      expect(liveMatches).toHaveLength(0);
    });

    test("cancelMatch returns players ahead of the existing queue", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, sessionId, pids, tenantId } = await setupActiveMatch(base);

      // Add a 5th player who should stay at the back of the queue
      const pid5 = await seedPlayer(t, tenantId, { firstName: "Later" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId: pid5 as any,
      });

      // Cancel the match — 4 players should return to front
      await t.mutation(api.openPlaySessions.cancelMatch, {
        matchId,
      });

      const sessionPlayers = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;

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
      const base = convexTest(schema, modules);
      const { t, sessionId } = await setupActiveMatch(base);

      const live = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      const matchId = live[0]._id;

      await t.mutation(api.openPlaySessions.recordMatchScore, {
        matchId,
        score1: 11,
        score2: 5,
      });

      const result = await t.mutation(api.openPlaySessions.cancelMatch, {
        matchId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/completed/i);
    });

    test("cancelMatch rejects a match with scores already recorded", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId } = await setupActiveMatch(base, true); // scored=true

      const result = await t.mutation(api.openPlaySessions.cancelMatch, {
        matchId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/scores/i);
    });

    // --- swapMatchPlayers ---

    test("swapMatchPlayers produces 4 unique players after swap", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, sessionId, pids } = await setupActiveMatch(base);

      // Swap pids[0] (team1) with pids[2] (team2)
      const result = await t.mutation(api.openPlaySessions.swapMatchPlayers, {
        matchId,
        playerAId: pids[0] as any,
        playerBId: pids[2] as any,
      });

      expect(result.success).toBe(true);

      const liveMatches = (await t.query(api.openPlaySessions.getLiveMatches, {
        sessionId,
      })).entries;
      const match = liveMatches[0];
      const allIds = [...match.team1, ...match.team2];
      expect(new Set(allIds).size).toBe(4);
      expect(match.team1).toContain(pids[2]);
      expect(match.team2).toContain(pids[0]);
    });

    test("swapMatchPlayers rejects a player not in the match", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, pids, tenantId } = await setupActiveMatch(base);

      const outsider = await seedPlayer(t, tenantId, { firstName: "Outside" });

      const result = await t.mutation(api.openPlaySessions.swapMatchPlayers, {
        matchId,
        playerAId: outsider as any,
        playerBId: pids[0] as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not in this match/i);
    });

    test("swapMatchPlayers rejects swapping a player with themselves", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, pids } = await setupActiveMatch(base);

      const result = await t.mutation(api.openPlaySessions.swapMatchPlayers, {
        matchId,
        playerAId: pids[0] as any,
        playerBId: pids[0] as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/themselves/i);
    });

    // --- substituteMatchPlayer ---

    test("substituteMatchPlayer with queued player succeeds", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, sessionId, pids, tenantId } = await setupActiveMatch(base);

      const pid5 = await seedPlayer(t, tenantId, { firstName: "Sub" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId: pid5 as any,
      });

      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId,
        outgoingPlayerId: pids[0] as any,
        incomingPlayerId: pid5 as any,
      });

      expect(result.success).toBe(true);

      const sessionPlayers = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;

      const incomingSP = sessionPlayers.find((sp) => sp.playerId === pid5);
      const outgoingSP = sessionPlayers.find((sp) => sp.playerId === pids[0]);

      expect(incomingSP?.status).toBe("playing");
      expect(outgoingSP?.status).toBe("queued");
    });

    test("substituteMatchPlayer with sitting_out player succeeds", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, sessionId, pids, tenantId } = await setupActiveMatch(base);

      const pid5 = await seedPlayer(t, tenantId, { firstName: "Sitter" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId: pid5 as any,
      });
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId,
        playerId: pid5 as any,
        status: "sitting_out",
      });

      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId,
        outgoingPlayerId: pids[1] as any,
        incomingPlayerId: pid5 as any,
      });

      expect(result.success).toBe(true);

      const sessionPlayers = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;
      const incomingSP = sessionPlayers.find((sp) => sp.playerId === pid5);
      expect(incomingSP?.status).toBe("playing");
    });

    test("substituteMatchPlayer rejects incoming player not in session", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, pids, tenantId } = await setupActiveMatch(base);

      const outsider = await seedPlayer(t, tenantId, { firstName: "Stranger" });

      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId,
        outgoingPlayerId: pids[0] as any,
        incomingPlayerId: outsider as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not checked into/i);
    });

    test("substituteMatchPlayer rejects incoming player who is already playing", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, pids } = await setupActiveMatch(base);

      // pids[3] is already in the match and marked "playing"
      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId,
        outgoingPlayerId: pids[0] as any,
        incomingPlayerId: pids[3] as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/queued or sitting out/i);
    });

    test("substituteMatchPlayer is blocked after scores are recorded", async () => {
      const base = convexTest(schema, modules);
      const { t, matchId, sessionId, pids, tenantId } = await setupActiveMatch(base, true);

      const pid5 = await seedPlayer(t, tenantId, { firstName: "Late" });
      await t.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId: pid5 as any,
      });

      const result = await t.mutation(api.openPlaySessions.substituteMatchPlayer, {
        matchId,
        outgoingPlayerId: pids[0] as any,
        incomingPlayerId: pid5 as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/scoring/i);
    });

    test("returning from sitting_out appends player to back of queue", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const t = asAdmin();
      const sessionId = await createSession(t, tenantId);

      const [p1, p2, p3] = await Promise.all([
        seedPlayer(t, tenantId, { firstName: "P1" }),
        seedPlayer(t, tenantId, { firstName: "P2" }),
        seedPlayer(t, tenantId, { firstName: "P3" }),
      ]);

      for (const pid of [p1, p2, p3]) {
        await t.mutation(api.openPlaySessions.checkInPlayer, {
          sessionId,
          playerId: pid,
        });
      }

      // Move p1 to sitting_out then return to queue
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId,
        playerId: p1 as any,
        status: "sitting_out",
      });
      await t.mutation(api.openPlaySessions.updatePlayerStatus, {
        sessionId,
        playerId: p1 as any,
        status: "queued",
      });

      const sessionPlayers = (await t.query(api.openPlaySessions.getSessionPlayers, {
        sessionId,
      })).entries;

      const p1SP = sessionPlayers.find((sp) => sp.playerId === p1);
      const p2SP = sessionPlayers.find((sp) => sp.playerId === p2);
      const p3SP = sessionPlayers.find((sp) => sp.playerId === p3);

      // p1 re-queued should be behind p2 and p3
      expect((p1SP?.queuePosition ?? 0)).toBeGreaterThan(p2SP?.queuePosition ?? 0);
      expect((p1SP?.queuePosition ?? 0)).toBeGreaterThan(p3SP?.queuePosition ?? 0);
    });
  });
});

  describe("Task 3.3 Authorization and Projections", () => {
    test("listByTenant rejects unauthenticated users and members of other tenants", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const tAuth = asAdmin();

      // Seed a second tenant directly (public tenant creation was removed
      // in Phase 2.4; only the internal seed/bootstrap path may create one).
      const otherTenantId = await tAuth.run(async (ctx) => {
        return ctx.db.insert("tenants", {
          name: "Other Venue",
          contactEmail: "other@testclub.com",
          slug: "other-venue",
          timezone: "America/Los_Angeles",
          workosOrganizationId: "local_seed_other",
          status: "active",
          createdAt: Date.now(),
        });
      });

      // Unauthenticated callers are rejected before any tenant work.
      await expect(
        base.query(api.openPlaySessions.listByTenant, { tenantId: otherTenantId })
      ).rejects.toThrow(/UNAUTHENTICATED/);

      // The admin identity is a member of `tenantId`, NOT `otherTenantId`,
      // so cross-tenant access is refused with FORBIDDEN.
      await expect(
        tAuth.query(api.openPlaySessions.listByTenant, { tenantId: otherTenantId })
      ).rejects.toThrow(/FORBIDDEN/);

      // Sanity: the same admin can list their own tenant's sessions.
      const own = await tAuth.query(api.openPlaySessions.listByTenant, { tenantId });
      expect(Array.isArray(own)).toBe(true);
    });

    test("createSession rejects a venue that belongs to another tenant", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const tAuth = asAdmin();

      // Second tenant the admin is also a member of (so `requireRole`
      // passes for it). It intentionally has NO `workosOrganizationId`:
      // `validateWorkOSClaim` only rejects on a *mismatch*, so a tenant
      // without a recorded org id lets the existing claim through, letting
      // the test reach the venue cross-check rather than failing at auth.
      const otherTenantId = await tAuth.run(async (ctx) => {
        const id = await ctx.db.insert("tenants", {
          name: "Other Venue",
          contactEmail: "other@testclub.com",
          slug: "other-venue",
          timezone: "America/Los_Angeles",
          status: "active",
          createdAt: Date.now(),
        });
        const adminUser = await ctx.db
          .query("users")
          .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", ADMIN_TOKEN))
          .unique();
        if (!adminUser) throw new Error("admin user not found");
        const now = Date.now();
        await ctx.db.insert("tenantMemberships", {
          tenantId: id,
          userId: adminUser._id,
          role: "owner",
          status: "active",
          workosOrganizationMembershipId: `mem_${ADMIN_TOKEN}_other`,
          createdAt: now,
          updatedAt: now,
        });
        return id;
      });

      // Venue created in the admin's own tenant.
      const venueResult = await tAuth.mutation(api.venues.createVenue, {
        tenantId,
        name: "Court 1",
        courtCount: 2,
      });
      if (!venueResult.success) throw new Error("venue creation failed");

      // createSession derives authorization from `args.tenantId`; the
      // caller is a member there. The venue cross-check then fails because
      // the venue belongs to `tenantId`, not `otherTenantId`.
      await expect(
        tAuth.mutation(api.openPlaySessions.createSession, {
          tenantId: otherTenantId,
          venueId: venueResult.venueId,
          name: "Mixed Venue Session",
          date: Date.now(),
          matchingMode: "auto_balanced",
        })
      ).rejects.toThrow(/Venue does not belong to the specified tenant/);
    });

    test("public projections mask private fields and bound results", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const tAuth = asAdmin();
      const sessionId = await createSession(tAuth, tenantId);

      await tAuth.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId,
        status: "live",
      });

      const created = await tAuth.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "Alice",
        lastName: "Smith",
        skillSource: "manual",
        email: "alice@example.com", // private
        manualSkillLevel: "Beginner",
      });
      if (!created.success || !created.playerId) throw new Error("player creation failed");

      await tAuth.mutation(api.openPlaySessions.checkInPlayer, {
        sessionId,
        playerId: created.playerId,
      });

      const publicPlayers = (
        await tAuth.query(api.openPlaySessions.getPublicSessionPlayers, { sessionId })
      ).entries;
      expect(publicPlayers).toHaveLength(1);

      const pPlayer = publicPlayers[0];
      // Private contact fields are never part of the public projection.
      expect((pPlayer as any).email).toBeUndefined();
      expect((pPlayer as any).phone).toBeUndefined();
      expect(pPlayer.playerDetails?.firstName).toBe("Alice");
      expect((pPlayer.playerDetails as any).email).toBeUndefined();
    });

    test("public projections expose only safe match fields", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const tAuth = asAdmin();
      const sessionId = await createSession(tAuth, tenantId);

      await tAuth.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId,
        status: "live",
      });

      const playerIds: Id<"players">[] = [];
      for (const letter of ["A", "B", "C", "D"]) {
        const created = await tAuth.mutation(api.players.createPlayer, {
          tenantId,
          firstName: letter,
          lastName: letter,
          skillSource: "manual",
          email: `${letter}@${letter}.com`,
          manualSkillLevel: "Beginner",
        });
        if (!created.success || !created.playerId) throw new Error("player creation failed");
        playerIds.push(created.playerId);
      }

      for (const playerId of playerIds) {
        await tAuth.mutation(api.openPlaySessions.checkInPlayer, { sessionId, playerId });
      }

      await tAuth.mutation(api.openPlaySessions.generateMatches, { sessionId });

      const live = (
        await tAuth.query(api.openPlaySessions.getPublicLiveMatches, { sessionId })
      ).entries;
      expect(live).toHaveLength(1);

      const firstPlayer = live[0].team1Details[0];
      expect(["A", "B", "C", "D"]).toContain(firstPlayer?.firstName);
      // Email/phone/notes are private and must not leak through the
      // public live-match projection.
      expect((firstPlayer as any).email).toBeUndefined();
      expect((firstPlayer as any).phone).toBeUndefined();
    });

    test("public match history exposes completed matches only, never cancelled audit rows", async () => {
      const base = convexTest(schema, modules);
      const { tenantId, asAdmin } = await seedTenantAuth(base);
      const tAuth = asAdmin();
      const sessionId = await createSession(tAuth, tenantId);

      await tAuth.mutation(api.openPlaySessions.updateSessionStatus, {
        sessionId,
        status: "live",
      });

      const playerIds: Id<"players">[] = [];
      for (const letter of ["A", "B", "C", "D"]) {
        const created = await tAuth.mutation(api.players.createPlayer, {
          tenantId,
          firstName: letter,
          lastName: letter,
          skillSource: "manual",
          manualSkillLevel: "Beginner",
        });
        if (!created.success || !created.playerId) throw new Error("player creation failed");
        playerIds.push(created.playerId);
      }
      for (const playerId of playerIds) {
        await tAuth.mutation(api.openPlaySessions.checkInPlayer, { sessionId, playerId });
      }

      // One completed match (scored)...
      await tAuth.mutation(api.openPlaySessions.generateMatches, { sessionId });
      const live = (
        await tAuth.query(api.openPlaySessions.getLiveMatches, { sessionId })
      ).entries;
      await tAuth.mutation(api.openPlaySessions.recordMatchScore, {
        matchId: live[0]._id,
        score1: 11,
        score2: 7,
      });

      // ...and one cancelled audit match, which must stay admin-only.
      await tAuth.mutation(api.openPlaySessions.generateMatches, { sessionId });
      const liveAfter = (
        await tAuth.query(api.openPlaySessions.getLiveMatches, { sessionId })
      ).entries;
      await tAuth.mutation(api.openPlaySessions.cancelMatch, {
        matchId: liveAfter[0]._id,
      });

      const publicHistory = (
        await tAuth.query(api.openPlaySessions.getPublicMatchHistory, { sessionId })
      ).entries;
      expect(publicHistory.every((m) => m.status === "completed")).toBe(true);
      expect(publicHistory).toHaveLength(1);

      // The admin history retains both the completed and cancelled rows.
      const adminHistory = (
        await tAuth.query(api.openPlaySessions.getMatchHistory, { sessionId })
      ).entries;
      expect(adminHistory.map((m) => m.status).sort()).toEqual(["cancelled", "completed"]);
    });
  });

describe("Task 3.4 operation authorization", () => {
  test.each(protectedOperationCases)(
    "$name rejects unauthenticated, player-role, and cross-tenant callers",
    async ({ invoke }) => {
      const fixture = await seedOperationAuthorizationFixture();

      await expect(invoke(fixture.base, fixture)).rejects.toThrow(/UNAUTHENTICATED/);
      await expect(invoke(fixture.playerActor, fixture)).rejects.toThrow(/FORBIDDEN/);
      await expect(invoke(fixture.crossTenantOwner, fixture)).rejects.toThrow(/FORBIDDEN/);
    },
  );

  test("a Game Master can check in a player", async () => {
    const fixture = await seedOperationAuthorizationFixture();

    const result = await fixture.gameMaster.mutation(api.openPlaySessions.checkInPlayer, {
      sessionId: fixture.sessionId,
      playerId: fixture.uncheckedPlayerId,
    });

    expect(result.success).toBe(true);
  });

  test("a Game Master can adjust an active match", async () => {
    const fixture = await seedOperationAuthorizationFixture();

    const result = await fixture.gameMaster.mutation(api.openPlaySessions.updateMatchCourt, {
      matchId: fixture.match._id,
      courtName: "Championship Court",
    });

    expect(result.success).toBe(true);
  });

  test("a Game Master can record a match score", async () => {
    const fixture = await seedOperationAuthorizationFixture();

    const result = await fixture.gameMaster.mutation(api.openPlaySessions.recordMatchScore, {
      matchId: fixture.match._id,
      score1: 11,
      score2: 7,
    });

    expect(result.success).toBe(true);
  });
});
