/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("Players", () => {
  async function seedTenant(t: ReturnType<typeof convexTest>) {
    return await t.mutation(internal.tenants.seed, {
      name: "Test Club",
      contactEmail: "gm@testclub.com",
    });
  }

  async function seedPlayer(
    t: ReturnType<typeof convexTest>,
    tenantId: any,
    override: Record<string, any> = {}
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("players", {
        tenantId,
        firstName: override.firstName ?? "Jane",
        lastName: override.lastName ?? "Doe",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        email: override.email,
        phone: override.phone,
        createdAt: Date.now(),
      });
    });
  }

  describe("createPlayer", () => {
    test("creates a player and returns its id", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      const result = await t.mutation(api.players.createPlayer, {
        tenantId: tenantId as any,
        firstName: "Alice",
        lastName: "Smith",
        skillSource: "manual",
        manualSkillLevel: "Beginner",
        email: "alice@example.com",
      });

      expect(result.success).toBe(true);
      expect((result as any).playerId).toBeDefined();
    });

    test("rejects duplicate email within the same tenant", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      await seedPlayer(t, tenantId, { email: "dup@example.com" });

      const result = await t.mutation(api.players.createPlayer, {
        tenantId: tenantId as any,
        firstName: "Bob",
        lastName: "Jones",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        email: "dup@example.com",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/email/i);
    });

    test("rejects duplicate phone within the same tenant", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      await seedPlayer(t, tenantId, { phone: "555-0001" });

      const result = await t.mutation(api.players.createPlayer, {
        tenantId: tenantId as any,
        firstName: "Carol",
        lastName: "White",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        phone: "555-0001",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/phone/i);
    });
  });

  describe("getById", () => {
    test("returns an existing player", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const playerId = await seedPlayer(t, tenantId, { firstName: "Eve" });

      const player = await t.query(api.players.getById, { playerId: playerId as any });

      expect(player).not.toBeNull();
      expect(player?.firstName).toBe("Eve");
    });

    test("returns null for a deleted player", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const playerId = await seedPlayer(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(playerId as any);
      });

      const player = await t.query(api.players.getById, { playerId: playerId as any });
      expect(player).toBeNull();
    });
  });

  describe("updatePlayer", () => {
    test("patches player fields", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const playerId = await seedPlayer(t, tenantId, { firstName: "Frank" });

      const result = await t.mutation(api.players.updatePlayer, {
        playerId: playerId as any,
        firstName: "Franklin",
        manualSkillLevel: "Advanced",
      });

      expect(result.success).toBe(true);
      const updated = await t.query(api.players.getById, { playerId: playerId as any });
      expect(updated?.firstName).toBe("Franklin");
      expect(updated?.manualSkillLevel).toBe("Advanced");
    });

    test("returns error for non-existent player", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const playerId = await seedPlayer(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(playerId as any);
      });

      const result = await t.mutation(api.players.updatePlayer, {
        playerId: playerId as any,
        firstName: "Ghost",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/not found/i);
    });
  });

  describe("deletePlayer", () => {
    test("removes a player", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const playerId = await seedPlayer(t, tenantId);

      const result = await t.mutation(api.players.deletePlayer, { playerId: playerId as any });
      expect(result.success).toBe(true);

      const gone = await t.query(api.players.getById, { playerId: playerId as any });
      expect(gone).toBeNull();
    });

    test("returns error when player does not exist", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const playerId = await seedPlayer(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(playerId as any);
      });

      const result = await t.mutation(api.players.deletePlayer, { playerId: playerId as any });
      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/not found/i);
    });
  });

  describe("getPlayerStats", () => {
    test("returns zeros when player has no stats snapshots", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const playerId = await seedPlayer(t, tenantId);

      const stats = await t.query(api.players.getPlayerStats, { playerId: playerId as any });

      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(0);
      expect(stats.pointsFor).toBe(0);
      expect(stats.pointsAgainst).toBe(0);
    });

    test("aggregates across multiple snapshots", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);
      const playerId = await seedPlayer(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.insert("statsSnapshots", {
          tenantId: tenantId as any,
          playerId: playerId as any,
          wins: 3,
          losses: 1,
          pointsFor: 33,
          pointsAgainst: 22,
          snapshotDate: Date.now(),
        });
        await ctx.db.insert("statsSnapshots", {
          tenantId: tenantId as any,
          playerId: playerId as any,
          wins: 2,
          losses: 2,
          pointsFor: 20,
          pointsAgainst: 18,
          snapshotDate: Date.now(),
        });
      });

      const stats = await t.query(api.players.getPlayerStats, { playerId: playerId as any });

      expect(stats.wins).toBe(5);
      expect(stats.losses).toBe(3);
      expect(stats.pointsFor).toBe(53);
      expect(stats.pointsAgainst).toBe(40);
    });
  });
});
