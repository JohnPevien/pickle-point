/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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

      expect(leaderboard).toEqual([]);
    });

    test("aggregates multiple snapshots per player and sorts by wins", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "Alice");
      const p2 = await seedPlayer(t, tenantId, "Bob");

      await seedSnapshot(t, tenantId, p1, 2, 1, 20, 15);
      await seedSnapshot(t, tenantId, p1, 3, 0, 30, 10);
      await seedSnapshot(t, tenantId, p2, 4, 2, 40, 30);

      const leaderboard = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });

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

      const leaderboard = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });

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

      const leaderboard = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
        limit: 2,
      });

      expect(leaderboard).toHaveLength(2);
      expect(leaderboard[0].firstName).toBe("One");
      expect(leaderboard[1].firstName).toBe("Two");
    });

    test("respects the snapshotLimit window", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "Old");
      const p2 = await seedPlayer(t, tenantId, "Recent");
      const now = Date.now();

      await seedSnapshot(t, tenantId, p1, 10, 0, 100, 10, now - 86_400_000);
      await seedSnapshot(t, tenantId, p2, 1, 0, 11, 5, now);

      const leaderboard = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
        snapshotLimit: 1,
      });

      expect(leaderboard).toHaveLength(1);
      expect(leaderboard[0].firstName).toBe("Recent");
    });

    test("includes player name fields in each entry", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const p1 = await seedPlayer(t, tenantId, "Maria");

      await seedSnapshot(t, tenantId, p1, 1, 0, 11, 5);

      const leaderboard = await t.query(api.stats.getLeaderboard, {
        tenantId: tenantId as any,
      });

      expect(leaderboard[0].firstName).toBe("Maria");
      expect(leaderboard[0].lastName).toBe("Test");
      expect(leaderboard[0].playerId).toBeDefined();
    });
  });
});
