import { v } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

const DEFAULT_LEADERBOARD_LIMIT = 25;
const MAX_LEADERBOARD_LIMIT = 100;
const DEFAULT_LEADERBOARD_WINDOW_DAYS = 30;
const MAX_LEADERBOARD_WINDOW_DAYS = 365;

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export const getLeaderboard = query({
  args: {
    tenantId: v.id("tenants"),
    limit: v.optional(v.number()),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? DEFAULT_LEADERBOARD_LIMIT, 1, MAX_LEADERBOARD_LIMIT);
    const windowDays = clampInt(
      args.windowDays ?? DEFAULT_LEADERBOARD_WINDOW_DAYS,
      1,
      MAX_LEADERBOARD_WINDOW_DAYS
    );
    const windowStart = Date.now() - windowDays * 24 * 60 * 60 * 1000;

    const snapshots = await ctx.db
      .query("statsSnapshots")
      .withIndex("by_tenantId_and_snapshotDate", (q) =>
        q.eq("tenantId", args.tenantId).gte("snapshotDate", windowStart)
      )
      .order("desc")
      .collect();

    const playerMap = new Map<string, {
      playerId: string;
      wins: number;
      losses: number;
      pointsFor: number;
      pointsAgainst: number;
    }>();

    for (const s of snapshots) {
      const key = s.playerId;
      const existing = playerMap.get(key);
      if (existing) {
        existing.wins += s.wins;
        existing.losses += s.losses;
        existing.pointsFor += s.pointsFor;
        existing.pointsAgainst += s.pointsAgainst;
      } else {
        playerMap.set(key, {
          playerId: s.playerId,
          wins: s.wins,
          losses: s.losses,
          pointsFor: s.pointsFor,
          pointsAgainst: s.pointsAgainst,
        });
      }
    }

    const sorted = [...playerMap.values()].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst);
    });

    const top = sorted.slice(0, limit);

    return await Promise.all(
      top.map(async (entry) => {
        const player = await ctx.db.get(entry.playerId as Id<"players">);
        return {
          ...entry,
          firstName: player?.firstName ?? "Unknown",
          lastName: player?.lastName ?? "Player",
        };
      })
    );
  },
});
