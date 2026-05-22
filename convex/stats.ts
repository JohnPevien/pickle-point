import { v } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

export const getLeaderboard = query({
  args: {
    tenantId: v.id("tenants"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const snapshots = await ctx.db
      .query("statsSnapshots")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
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

    const top = sorted.slice(0, args.limit ?? 25);

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
