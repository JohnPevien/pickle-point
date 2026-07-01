/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

type TestContext = TestConvex<typeof schema>;
type BackfillResult = {
  matchesScanned: number;
  referencesCreated: number;
  referencesMissing: number;
  isDone: boolean;
  cursor: string;
};

const backfillTenant = (internal as any).migrations.matchHistoryParticipants
  .backfillTenant;

async function seedTenant(
  t: TestContext,
  suffix: string
): Promise<Id<"tenants">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("tenants", {
      name: `Migration Club ${suffix}`,
      slug: `migration-club-${suffix}`,
      timezone: "Asia/Manila",
      workosOrganizationId: `org_migration_${suffix}`,
      status: "active",
      contactEmail: `admin-${suffix}@example.com`,
      createdAt: Date.now(),
    })
  );
}

async function seedPlayer(
  t: TestContext,
  tenantId: Id<"tenants">,
  suffix: string
): Promise<Id<"players">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("players", {
      tenantId,
      firstName: `Player ${suffix}`,
      lastName: "Migration",
      skillSource: "manual",
      manualSkillLevel: "Novice",
      createdAt: Date.now(),
    })
  );
}

async function seedLegacyMatch(
  t: TestContext,
  tenantId: Id<"tenants">,
  players: Id<"players">[]
): Promise<Id<"matchHistory">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("matchHistory", {
      tenantId,
      players,
      scores: [11, 9],
      winners: players.slice(0, 1),
      playedAt: Date.now(),
    })
  );
}

async function listReferences(
  t: TestContext,
  matchHistoryId: Id<"matchHistory">
) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("matchHistoryParticipants")
      .withIndex("by_matchHistoryId", (q) =>
        q.eq("matchHistoryId", matchHistoryId)
      )
      .collect()
  );
}

async function seedOwner(
  t: TestContext,
  tenantId: Id<"tenants">,
  suffix: string
) {
  const tokenIdentifier = `https://api.workos.com|migration-owner-${suffix}`;
  const workosMembershipId = `wosm_migration_owner_${suffix}`;
  const userId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("users", {
      tokenIdentifier,
      workosUserId: `workos_owner_${suffix}`,
      email: `owner-${suffix}@example.com`,
      emailNormalized: `owner-${suffix}@example.com`,
      tenantId,
      createdAt: now,
      lastSeenAt: now,
    });
    await ctx.db.insert("tenantMemberships", {
      tenantId,
      userId: id,
      role: "owner",
      status: "active",
      workosOrganizationMembershipId: workosMembershipId,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
  void userId;

  return t.withIdentity({
    tokenIdentifier,
    subject: `migration-owner-${suffix}`,
    issuer: "https://api.workos.com",
    name: "Migration Owner",
    email: `owner-${suffix}@example.com`,
    organization_id: `org_migration_${suffix}`,
    organization_membership_id: workosMembershipId,
    role: "owner",
  });
}

async function runAllBatches(
  t: TestContext,
  tenantId: Id<"tenants">,
  batchSize: number
): Promise<number> {
  let cursor: string | null = null;
  let referencesCreated = 0;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const result: BackfillResult = await t.mutation(backfillTenant, {
      tenantId,
      batchSize,
      cursor,
    });
    referencesCreated += result.referencesCreated;
    cursor = result.cursor;
    if (result.isDone) return referencesCreated;
  }
  throw new Error("Backfill did not finish within 20 batches");
}

describe("matchHistoryParticipants migration", () => {
  test("dry-run reports missing references without writing them", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "dry-run");
    const player1 = await seedPlayer(t, tenantId, "dry-1");
    const player2 = await seedPlayer(t, tenantId, "dry-2");
    const matchId = await seedLegacyMatch(t, tenantId, [player1, player2]);

    const result = await t.mutation(backfillTenant, {
      tenantId,
      dryRun: true,
    });

    expect(result).toMatchObject({
      matchesScanned: 1,
      referencesCreated: 0,
      referencesMissing: 2,
      isDone: true,
    });
    expect(await listReferences(t, matchId)).toEqual([]);
  });

  test("backfills multiple bounded pages and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "paged");
    const players = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        seedPlayer(t, tenantId, `paged-${index}`)
      )
    );
    await seedLegacyMatch(t, tenantId, [players[0], players[1]]);
    await seedLegacyMatch(t, tenantId, [players[1], players[2]]);
    await seedLegacyMatch(t, tenantId, [players[2], players[3]]);

    expect(await runAllBatches(t, tenantId, 1)).toBe(6);
    expect(await runAllBatches(t, tenantId, 1)).toBe(0);
  });

  test("repairs a partially populated match and deduplicates player ids", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "partial");
    const player1 = await seedPlayer(t, tenantId, "partial-1");
    const player2 = await seedPlayer(t, tenantId, "partial-2");
    const matchId = await seedLegacyMatch(t, tenantId, [
      player1,
      player1,
      player2,
    ]);
    await t.run(async (ctx) =>
      ctx.db.insert("matchHistoryParticipants", {
        matchHistoryId: matchId,
        tenantId,
        playerId: player1,
      })
    );

    const result = await t.mutation(backfillTenant, { tenantId });
    const references = await listReferences(t, matchId);

    expect(result.referencesCreated).toBe(1);
    expect(references).toHaveLength(2);
    expect(new Set(references.map((row) => row.playerId))).toEqual(
      new Set([player1, player2])
    );
  });

  test("never processes another tenant's matches", async () => {
    const t = convexTest(schema, modules);
    const tenantA = await seedTenant(t, "tenant-a");
    const tenantB = await seedTenant(t, "tenant-b");
    const playerA = await seedPlayer(t, tenantA, "tenant-a");
    const playerB = await seedPlayer(t, tenantB, "tenant-b");
    const matchA = await seedLegacyMatch(t, tenantA, [playerA]);
    const matchB = await seedLegacyMatch(t, tenantB, [playerB]);

    await t.mutation(backfillTenant, { tenantId: tenantA });

    expect(await listReferences(t, matchA)).toHaveLength(1);
    expect(await listReferences(t, matchB)).toEqual([]);
  });

  test("makes deletePlayer reject a player referenced only by legacy history", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "delete");
    const owner = await seedOwner(t, tenantId, "delete");
    const player1 = await seedPlayer(t, tenantId, "delete-1");
    const player2 = await seedPlayer(t, tenantId, "delete-2");
    await seedLegacyMatch(t, tenantId, [player1, player2]);

    await runAllBatches(t, tenantId, 10);
    const result = await owner.mutation(api.players.deletePlayer, {
      tenantId,
      playerId: player1,
    });

    expect(result).toEqual({
      success: false,
      error: "Cannot delete player with existing match history.",
    });
  });

  test("rejects a missing tenant", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "missing");
    await t.run(async (ctx) => ctx.db.delete(tenantId));

    await expect(
      t.mutation(backfillTenant, { tenantId })
    ).rejects.toThrow(/Tenant row missing during match-history backfill/);
  });

  test("rejects a malformed match with too many distinct players", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "oversized");
    const players: Id<"players">[] = [];
    for (let index = 0; index < 65; index += 1) {
      players.push(await seedPlayer(t, tenantId, `oversized-${index}`));
    }
    await seedLegacyMatch(t, tenantId, players);

    await expect(
      t.mutation(backfillTenant, { tenantId })
    ).rejects.toThrow(/more than 64 distinct players/);
  });
});
