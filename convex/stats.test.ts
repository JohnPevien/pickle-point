/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("Stats", () => {
  async function seedTenant(t: ReturnType<typeof convexTest>) {
    return await t.mutation(internal.tenants.seed, {
      name: "Test Club",
      contactEmail: "gm@testclub.com",
    });
  }

  async function seedPlayer(
    t: ReturnType<typeof convexTest>,
    tenantId: any,
    firstName: string
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("players", {
        tenantId,
        firstName,
        lastName: "Test",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        createdAt: Date.now(),
      });
    });
  }

  async function seedSnapshot(
    t: ReturnType<typeof convexTest>,
    tenantId: any,
    playerId: any,
    wins: number,
    losses: number,
    pointsFor: number,
    pointsAgainst: number,
    snapshotDate: number = Date.now()
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("statsSnapshots", {
        tenantId,
        playerId,
        wins,
        losses,
        pointsFor,
        pointsAgainst,
        snapshotDate,
      });
    });
  }

  describe("getLeaderboard", () => {
    test("returns empty array when there are no snapshots", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      const leaderboard = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });

      expect(leaderboard).toEqual({ entries: [], truncated: false });
    });

    test("aggregates multiple snapshots per player and sorts by wins", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "Alice");
      const p2 = await seedPlayer(t, tenantId, "Bob");

      await seedSnapshot(t, tenantId, p1, 2, 1, 20, 15);
      await seedSnapshot(t, tenantId, p1, 3, 0, 30, 10);
      await seedSnapshot(t, tenantId, p2, 4, 2, 40, 30);

      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });
      const leaderboard = result.entries;

      expect(leaderboard).toHaveLength(2);
      expect(leaderboard[0].firstName).toBe("Alice");
      expect(leaderboard[0].wins).toBe(5);
      expect(leaderboard[1].firstName).toBe("Bob");
      expect(leaderboard[1].wins).toBe(4);
    });

    test("breaks ties by point differential", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "Tied1");
      const p2 = await seedPlayer(t, tenantId, "Tied2");

      await seedSnapshot(t, tenantId, p1, 3, 1, 22, 20);
      await seedSnapshot(t, tenantId, p2, 3, 1, 30, 20);

      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });
      const leaderboard = result.entries;

      expect(leaderboard[0].firstName).toBe("Tied2");
      expect(leaderboard[0].pointsFor - leaderboard[0].pointsAgainst).toBe(10);
      expect(leaderboard[1].firstName).toBe("Tied1");
      expect(leaderboard[1].pointsFor - leaderboard[1].pointsAgainst).toBe(2);
    });

    test("respects the limit parameter", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "One");
      const p2 = await seedPlayer(t, tenantId, "Two");
      const p3 = await seedPlayer(t, tenantId, "Three");

      await seedSnapshot(t, tenantId, p1, 5, 0, 50, 10);
      await seedSnapshot(t, tenantId, p2, 4, 1, 40, 15);
      await seedSnapshot(t, tenantId, p3, 3, 2, 30, 20);

      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
        limit: 2,
      });
      const leaderboard = result.entries;

      expect(leaderboard).toHaveLength(2);
      expect(leaderboard[0].firstName).toBe("One");
      expect(leaderboard[1].firstName).toBe("Two");
    });

    test("respects the windowDays window", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "Old");
      const p2 = await seedPlayer(t, tenantId, "Recent");
      const now = Date.now();

      await seedSnapshot(t, tenantId, p1, 10, 0, 100, 10, now - 2 * 86_400_000);
      await seedSnapshot(t, tenantId, p2, 1, 0, 11, 5, now);

      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
        windowDays: 1,
      });
      const leaderboard = result.entries;

      expect(leaderboard).toHaveLength(1);
      expect(leaderboard[0].firstName).toBe("Recent");
    });

    test("clamps limit to a safe maximum", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      for (let index = 0; index < 110; index++) {
        const playerId = await seedPlayer(t, tenantId, `P${index}`);
        await seedSnapshot(t, tenantId, playerId, 110 - index, index, 20, 10);
      }

      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
        limit: 500,
      });
      const leaderboard = result.entries;

      expect(leaderboard).toHaveLength(100);
    });

    test("includes player name fields in each entry", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "Maria");

      await seedSnapshot(t, tenantId, p1, 1, 0, 11, 5);

      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });
      const leaderboard = result.entries;

      expect(leaderboard[0].firstName).toBe("Maria");
      expect(leaderboard[0].lastName).toBe("Test");
      expect(leaderboard[0].playerId).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Phase 3.2 review fix: a corrupt/invalid top-ranked snapshot must
  // not consume the only leaderboard slot — the valid #2 must surface.
  // -------------------------------------------------------------------------

  describe("getLeaderboard cross-tenant exclusion (Phase 3.2 review)", () => {
    test("limit:1 with an invalid top-ranked player surfaces the valid #2", async () => {
      // A "top-ranked" snapshot whose playerId is missing or belongs
      // to another tenant must be skipped — otherwise a corrupt
      // snapshot would consume the only available slot and hide a
      // legitimate player. With limit:1 we expect the second-ranked
      // player to surface.
      const t = convexTest(schema, modules);
      const tenantA = await t.mutation(internal.tenants.seed, {
        name: "Club A",
        contactEmail: "a@phase32.test",
      });
      const tenantB = await t.mutation(internal.tenants.seed, {
        name: "Club B",
        contactEmail: "b@phase32.test",
      });

      const home = await seedPlayer(t, tenantA, "Home");
      const ghost = await seedPlayer(t, tenantA, "Ghost");
      const foreign = await seedPlayer(t, tenantB, "Foreign");

      // Ghost: deleted, but its (stale) snapshot still references it.
      await t.run(async (ctx) => ctx.db.delete(ghost));

      // Snapshot for a deleted player (most wins) — invalid.
      await t.run(async (ctx) =>
        ctx.db.insert("statsSnapshots", {
          tenantId: tenantA,
          playerId: ghost,
          wins: 100,
          losses: 0,
          pointsFor: 1000,
          pointsAgainst: 0,
          snapshotDate: Date.now(),
        })
      );
      // Snapshot for a cross-tenant player (more wins than Home).
      await t.run(async (ctx) =>
        ctx.db.insert("statsSnapshots", {
          tenantId: tenantA,
          playerId: foreign,
          wins: 50,
          losses: 0,
          pointsFor: 500,
          pointsAgainst: 0,
          snapshotDate: Date.now(),
        })
      );
      // Home has fewer wins but is the only valid candidate.
      await seedSnapshot(t, tenantA, home, 5, 0, 50, 10);

      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantA as any,
        limit: 1,
      });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].firstName).toBe("Home");
      expect(result.entries[0].playerId).toBe(home);
    });
  });

  // -------------------------------------------------------------------------
  // Task 3.2: public projection hardening for getLeaderboard.
  // -------------------------------------------------------------------------

  describe("getLeaderboard public projection (Phase 3.2)", () => {
    test("returns an empty result for a disabled tenant (active-only)", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "Ghost");
      await seedSnapshot(t, tenantId, p1, 5, 0, 50, 10);

      await t.run(async (ctx) => {
        await ctx.db.patch(tenantId as any, { status: "disabled" });
      });

      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });

      expect(result.entries).toEqual([]);
    });

    test("excludes snapshots whose player is missing or belongs to another tenant", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      // Seed a second tenant via direct insert (seedTenant dedupes by email).
      const tenantB = await t.run(async (ctx) =>
        ctx.db.insert("tenants", {
          name: "Other Club",
          contactEmail: "other-stats@example.com",
          slug: "other-club-stats",
          timezone: "Asia/Manila",
          workosOrganizationId: "org_other_stats",
          status: "active",
          createdAt: Date.now(),
        })
      );

      const homePlayer = await seedPlayer(t, tenantId, "Home");
      const foreignPlayer = await seedPlayer(t, tenantB, "Foreign");
      // Snapshot referencing a player in another tenant.
      await seedSnapshot(t, tenantId, foreignPlayer, 99, 0, 990, 0);
      // Snapshot referencing a home player (should appear).
      await seedSnapshot(t, tenantId, homePlayer, 1, 0, 11, 5);
      // Snapshot referencing a deleted/missing player.
      const ghost = await seedPlayer(t, tenantId, "Ghost");
      await seedSnapshot(t, tenantId, ghost, 50, 0, 500, 0);
      await t.run(async (ctx) => ctx.db.delete(ghost));

      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });
      const leaderboard = result.entries;

      // Only the home player appears. The foreign player and the missing
      // player are excluded entirely — no "Unknown" row, no leaked playerId.
      expect(leaderboard).toHaveLength(1);
      expect(leaderboard[0].firstName).toBe("Home");
      expect(leaderboard.find((e: any) => e.firstName === "Foreign")).toBeUndefined();
      expect(leaderboard.find((e: any) => e.firstName === "Unknown")).toBeUndefined();
    });

    test("exposes only allowed public display fields, never contact/private data", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      // Seed a player WITH private contact fields to prove they never leak.
      const p1 = await t.run(async (ctx) =>
        ctx.db.insert("players", {
          tenantId: tenantId as any,
          firstName: "Private",
          lastName: "Person",
          skillSource: "manual",
          manualSkillLevel: "Novice",
          email: "secret@example.com",
          phone: "5551234",
          notes: "private notes",
          optIn: true,
          createdAt: Date.now(),
        })
      );
      await seedSnapshot(t, tenantId, p1, 2, 1, 22, 15);

      // Unauthenticated call — public_read.
      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });
      const entry = result.entries[0];

      // Allowed public display fields.
      expect(entry).toMatchObject({
        playerId: p1,
        firstName: "Private",
        lastName: "Person",
        wins: 2,
        losses: 1,
        pointsFor: 22,
        pointsAgainst: 15,
      });
      // Private/contact fields must never appear on the public projection.
      expect((entry as any).email).toBeUndefined();
      expect((entry as any).phone).toBeUndefined();
      expect((entry as any).notes).toBeUndefined();
      expect((entry as any).optIn).toBeUndefined();
      expect((entry as any).tenantId).toBeUndefined();
    });

    test("is callable without authentication (public_read)", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "Anon");
      await seedSnapshot(t, tenantId, p1, 1, 0, 11, 5);

      // No withIdentity — fully unauthenticated.
      const result = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });

      expect(result.entries[0].firstName).toBe("Anon");
    });
  });
});
