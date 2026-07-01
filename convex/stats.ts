import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";
import { finiteInt } from "./lib/num";

const DEFAULT_LEADERBOARD_LIMIT = 25;
const MAX_LEADERBOARD_LIMIT = 100;
const DEFAULT_LEADERBOARD_WINDOW_DAYS = 30;
const MAX_LEADERBOARD_WINDOW_DAYS = 365;

/**
 * Defensive cap on the number of snapshots read by `getLeaderboard`. The
 * query already constrains by a day window and slices to `limit` (≤ 100)
 * after aggregation; this cap protects against pathological snapshot
 * volume. When exceeded, the response carries `truncated: true`.
 */
const MAX_LEADERBOARD_SNAPSHOTS = 1000;

/**
 * Allowed public display fields for a leaderboard entry. Personal data
 * (first/last name) is permitted here by the product spec as public display
 * names; contact fields (email/phone/notes/optIn) and WorkOS identity are
 * never part of this projection.
 */
type LeaderboardEntry = {
  playerId: Id<"players">;
  firstName: string;
  lastName: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
};

type LeaderboardResult = {
  entries: LeaderboardEntry[];
  truncated: boolean;
};

/**
 * Builds a tenant leaderboard from recent stats snapshots, ranked by wins
 * and point differential. Task 3.2 hardening:
 *
 * - **Public projection** (`public_read`, no auth): returns only the safe
 *   display fields above — never contact/private data or full player docs.
 * - **Active-tenant gate**: a missing or disabled tenant resolves to an
 *   empty result, matching `tenants.getPublicBySlug`.
 * - **Cross-tenant/missing reference exclusion**: snapshots whose player is
 *   missing or belongs to a different tenant are dropped entirely (no
 *   "Unknown" row, no leaked `playerId`).
 * - **Bounded read**: snapshots are read newest-first up to
 *   `MAX_LEADERBOARD_SNAPSHOTS + 1`; `truncated` flags a partial aggregate.
 *
 * Collision-aware display names (Task 4.6) are out of scope here.
 */
export const getLeaderboard = query({
  args: {
    tenantId: v.id("tenants"),
    limit: v.optional(v.number()),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<LeaderboardResult> => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant || tenant.status !== "active") {
      return { entries: [], truncated: false };
    }

    const limit = finiteInt(
      args.limit ?? DEFAULT_LEADERBOARD_LIMIT,
      1,
      MAX_LEADERBOARD_LIMIT,
      DEFAULT_LEADERBOARD_LIMIT
    );
    const windowDays = finiteInt(
      args.windowDays ?? DEFAULT_LEADERBOARD_WINDOW_DAYS,
      1,
      MAX_LEADERBOARD_WINDOW_DAYS,
      DEFAULT_LEADERBOARD_WINDOW_DAYS
    );
    const windowStart = Date.now() - windowDays * 24 * 60 * 60 * 1000;

    // Fetch MAX + 1 so we can detect truncation without an extra count.
    const snapshots = await ctx.db
      .query("statsSnapshots")
      .withIndex("by_tenantId_and_snapshotDate", (q) =>
        q.eq("tenantId", args.tenantId).gte("snapshotDate", windowStart)
      )
      .order("desc")
      .take(MAX_LEADERBOARD_SNAPSHOTS + 1);

    const truncated = snapshots.length > MAX_LEADERBOARD_SNAPSHOTS;
    const considered = truncated
      ? snapshots.slice(0, MAX_LEADERBOARD_SNAPSHOTS)
      : snapshots;

    const playerMap = new Map<
      Id<"players">,
      {
        playerId: Id<"players">;
        wins: number;
        losses: number;
        pointsFor: number;
        pointsAgainst: number;
      }
    >();

    for (const s of considered) {
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

    // Validate each candidate against the players table BEFORE applying
    // the limit. A corrupt (missing or cross-tenant) player must not
    // consume a slot — otherwise a single bad snapshot hides every
    // valid entry below it. Once we have `limit` valid entries we stop.
    const entries: LeaderboardEntry[] = [];
    for (const candidate of sorted) {
      if (entries.length >= limit) break;
      const player: Doc<"players"> | null = await ctx.db.get(candidate.playerId);
      if (!player || player.tenantId !== args.tenantId) {
        continue;
      }
      entries.push({
        playerId: player._id,
        firstName: player.firstName,
        lastName: player.lastName,
        wins: candidate.wins,
        losses: candidate.losses,
        pointsFor: candidate.pointsFor,
        pointsAgainst: candidate.pointsAgainst,
      });
    }

    return { entries, truncated };
  },
});
