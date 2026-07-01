import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { finiteInt } from "../lib/num";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const MAX_PLAYERS_PER_MATCH = 64;

/**
 * Backfill the scalar participant references used by the bounded
 * `players.deletePlayer` match-history blocker.
 *
 * This migration is deliberately tenant-scoped, cursor-paginated, and
 * idempotent. Operators invoke one page at a time and pass the returned
 * cursor back until `isDone` is true. `dryRun` performs the same reads and
 * reports missing references without writing them.
 */
export const backfillTenant = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    matchesScanned: number;
    referencesCreated: number;
    referencesMissing: number;
    isDone: boolean;
    cursor: string;
  }> => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant row missing during match-history backfill");
    }

    const batchSize = finiteInt(
      args.batchSize ?? DEFAULT_BATCH_SIZE,
      1,
      MAX_BATCH_SIZE,
      DEFAULT_BATCH_SIZE
    );
    const page = await ctx.db
      .query("matchHistory")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("asc")
      .paginate({
        numItems: batchSize,
        cursor: args.cursor ?? null,
      });

    let referencesCreated = 0;
    let referencesMissing = 0;

    for (const match of page.page) {
      const playerIds = [...new Set(match.players)];
      if (playerIds.length > MAX_PLAYERS_PER_MATCH) {
        throw new Error(
          `Match ${match._id} has more than ${MAX_PLAYERS_PER_MATCH} distinct players`
        );
      }

      const existing = await ctx.db
        .query("matchHistoryParticipants")
        .withIndex("by_matchHistoryId", (q) =>
          q.eq("matchHistoryId", match._id)
        )
        .take(MAX_PLAYERS_PER_MATCH + 1);
      if (existing.length > MAX_PLAYERS_PER_MATCH) {
        throw new Error(
          `Match ${match._id} has more than ${MAX_PLAYERS_PER_MATCH} participant references`
        );
      }

      const existingPlayerIds = new Set(
        existing
          .filter((row) => row.tenantId === match.tenantId)
          .map((row) => row.playerId)
      );
      for (const playerId of playerIds) {
        if (existingPlayerIds.has(playerId)) continue;

        referencesMissing += 1;
        if (args.dryRun) continue;

        await ctx.db.insert("matchHistoryParticipants", {
          matchHistoryId: match._id,
          tenantId: match.tenantId,
          playerId,
        });
        referencesCreated += 1;
      }
    }

    return {
      matchesScanned: page.page.length,
      referencesCreated,
      referencesMissing,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});
