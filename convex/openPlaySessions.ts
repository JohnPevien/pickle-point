import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireRole, AppError } from "./lib/authz";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  findPlayerByContact,
  legacyContactValue,
  normalizeEmail,
  normalizePhone,
} from "./playerContact";

// Skill mapping for numerical comparison and balancing
const SKILL_MAP: Record<string, number> = {
  "Beginner": 1.0,
  "Novice": 2.0,
  "Low Intermediate": 3.0,
  "High Intermediate": 4.0,
  "Advanced": 5.0,
};

const DEFAULT_SESSION_LIST_LIMIT = 50;
const MAX_SESSION_LIST_LIMIT = 100;
const INITIAL_ROTATION_METADATA = {
  matchesPlayed: 0,
  sitOutCount: 0,
  consecutiveSitOuts: 0,
  lastPlayedAt: undefined,
  lastSatOutAt: undefined,
} as const;

type SessionPlayerDoc = Doc<"sessionPlayers">;
type SessionPlayerPatch = Partial<Omit<SessionPlayerDoc, "_id" | "_creationTime">>;

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function requiredName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function rotationNumber(
  player: SessionPlayerDoc,
  field: "matchesPlayed" | "sitOutCount" | "consecutiveSitOuts"
) {
  return player[field] ?? 0;
}

function compareRotationPriority(a: SessionPlayerDoc, b: SessionPlayerDoc) {
  const consecutiveDiff = rotationNumber(b, "consecutiveSitOuts") - rotationNumber(a, "consecutiveSitOuts");
  if (consecutiveDiff !== 0) return consecutiveDiff;

  const sitOutDiff = rotationNumber(b, "sitOutCount") - rotationNumber(a, "sitOutCount");
  if (sitOutDiff !== 0) return sitOutDiff;

  const aLastPlayed = a.lastPlayedAt ?? Number.NEGATIVE_INFINITY;
  const bLastPlayed = b.lastPlayedAt ?? Number.NEGATIVE_INFINITY;
  if (aLastPlayed !== bLastPlayed) return aLastPlayed - bLastPlayed;

  const queueDiff =
    (a.queuePosition ?? Number.MAX_SAFE_INTEGER) -
    (b.queuePosition ?? Number.MAX_SAFE_INTEGER);
  if (queueDiff !== 0) return queueDiff;

  return a.checkedInAt - b.checkedInAt;
}

function markPlayerPlaying(player: SessionPlayerDoc, timestamp: number): SessionPlayerPatch {
  return {
    status: "playing",
    queuePosition: undefined,
    matchesPlayed: rotationNumber(player, "matchesPlayed") + 1,
    consecutiveSitOuts: 0,
    lastPlayedAt: timestamp,
  };
}

function markPlayerSittingOut(player: SessionPlayerDoc, timestamp: number): SessionPlayerPatch {
  return {
    status: "sitting_out",
    sitOutCount: rotationNumber(player, "sitOutCount") + 1,
    consecutiveSitOuts: rotationNumber(player, "consecutiveSitOuts") + 1,
    lastSatOutAt: timestamp,
  };
}

async function allocateQueuePositions(
  ctx: MutationCtx,
  sessionId: Id<"openPlaySessions">,
  count = 1
) {
  if (count <= 0) return [];

  const counter = await ctx.db
    .query("sessionQueueCounters")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .first();

  let startPosition: number;
  if (counter) {
    startPosition = counter.nextPosition;
    await ctx.db.patch(counter._id, {
      nextPosition: counter.nextPosition + count,
      updatedAt: Date.now(),
    });
  } else {
    // Migration fallback for sessions created before queue counters existed.
    const queuedTail = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_sessionId_and_status_and_queuePosition", (q) =>
        q.eq("sessionId", sessionId).eq("status", "queued")
      )
      .order("desc")
      .first();
    startPosition = (queuedTail?.queuePosition ?? 0) + 1;
    await ctx.db.insert("sessionQueueCounters", {
      sessionId,
      nextPosition: startPosition + count,
      updatedAt: Date.now(),
    });
  }

  return Array.from({ length: count }, (_, index) => startPosition + index);
}

async function getSessionMatchesByStatus(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"openPlaySessions">,
  status: Doc<"sessionMatches">["status"],
  limit?: number,
  order: "asc" | "desc" = "asc"
) {
  const q = ctx.db
    .query("sessionMatches")
    .withIndex("by_sessionId_and_status", (q) =>
      q.eq("sessionId", sessionId).eq("status", status)
    )
    .order(order);
  if (limit) {
    return await q.take(limit);
  }
  return await q.collect();
}

/**
 * Allocates N positions at the front of the queue (using a decremented counter).
 * Players returned here will sort before all normally-queued players (positions >= 1).
 */
async function allocateFrontQueuePositions(
  ctx: MutationCtx,
  sessionId: Id<"openPlaySessions">,
  count = 1
): Promise<number[]> {
  if (count <= 0) return [];

  const counter = await ctx.db
    .query("sessionQueueCounters")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .first();

  if (counter) {
    const currentFront = counter.frontNextPosition ?? 0;
    const positions = Array.from({ length: count }, (_, i) => currentFront - i);
    await ctx.db.patch(counter._id, {
      frontNextPosition: currentFront - count,
      updatedAt: Date.now(),
    });
    return positions;
  }

  // Fallback: counter doesn't exist yet. Create it seeded from the existing
  // tail of the queue so we never hand out positions that collide with players
  // already enqueued (e.g. a legacy session whose counter was deleted or whose
  // rows predate the counter feature).
  const queuedTail = await ctx.db
    .query("sessionPlayers")
    .withIndex("by_sessionId_and_status_and_queuePosition", (q) =>
      q.eq("sessionId", sessionId).eq("status", "queued")
    )
    .order("desc")
    .first();
  const nextPosition = Math.max(1, (queuedTail?.queuePosition ?? 0) + 1);
  const positions = Array.from({ length: count }, (_, i) => -i);
  await ctx.db.insert("sessionQueueCounters", {
    sessionId,
    nextPosition,
    frontNextPosition: -count,
    updatedAt: Date.now(),
  });
  return positions;
}

/**
 * ---------------------------------------------------------------------------
 * 1. SESSION LIFECYCLE
 * ---------------------------------------------------------------------------
 */

/**
 * Creates a new Open Play session in "draft" status.
 */
export const createSession = mutation({
  args: {
    tenantId: v.id("tenants"), venueId: v.optional(v.id("venues")), name: v.string(), date: v.number(),
    matchingMode: v.union(v.literal("auto_balanced"), v.literal("skill_separated"), v.literal("winners_vs_losers"), v.literal("mixed_doubles"), v.literal("skill_courts")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.tenantId, ["owner", "game_master"]);
    if (args.venueId) {
      const venue = await ctx.db.get(args.venueId);
      if (!venue || venue.tenantId !== args.tenantId) throw new AppError("FORBIDDEN", "Venue does not belong to the specified tenant.");
    }
    const name = requiredName(args.name);
    if (!name) {
      return { success: false, error: "Session name is required." };
    }

    const sessionId = await ctx.db.insert("openPlaySessions", {
      tenantId: args.tenantId,
      venueId: args.venueId,
      name,
      date: args.date,
      status: "draft",
      matchingMode: args.matchingMode,
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessionQueueCounters", {
      sessionId,
      nextPosition: 1,
      updatedAt: Date.now(),
    });
    return sessionId;
  },
});

/**
 * Lists open play sessions for a given tenant, newest-created first.
 *
 * Bounded read: instead of `.collect()` (which loads every row), we cap
 * the scan at `MAX_SESSION_LIST_LIMIT`. Callers may request a smaller
 * page via `limit`; the value is clamped to `[1, MAX_SESSION_LIST_LIMIT]`.
 * The `by_tenant` index orders equal tenant keys by creation time, so the
 * descending scan selects the newest rows before applying the limit.
 */
export const listByTenant = query({
  args: {
    tenantId: v.id("tenants"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.tenantId, ["owner", "game_master"]);
    const limit = clampInt(args.limit ?? DEFAULT_SESSION_LIST_LIMIT, 1, MAX_SESSION_LIST_LIMIT);
    const list = await ctx.db
      .query("openPlaySessions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(limit);
    return list;
  },
});

/**
 * Gets a single open play session by ID.
 */
export const getById = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);
    return session;
  },
});

/**
 * Updates a session's lifecycle status.
 */
export const updateSessionStatus = mutation({
  args: {
    sessionId: v.id("openPlaySessions"),
    status: v.union(v.literal("draft"), v.literal("check_in"), v.literal("live"), v.literal("completed"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return { success: false, error: "Session not found." };
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    await ctx.db.patch(args.sessionId, { status: args.status });
    return { success: true };
  },
});

/**
 * Updates the matching mode for a session.
 */
export const updateSessionMatchingMode = mutation({
  args: {
    sessionId: v.id("openPlaySessions"),
    matchingMode: v.union(v.literal("auto_balanced"), v.literal("skill_separated"), v.literal("winners_vs_losers"), v.literal("mixed_doubles"), v.literal("skill_courts")),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return { success: false, error: "Session not found." };
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    await ctx.db.patch(args.sessionId, { matchingMode: args.matchingMode });
    return { success: true };
  },
});


/**
 * ---------------------------------------------------------------------------
 * 2. PLAYER CHECK-IN & QUEUE MANAGEMENT
 * ---------------------------------------------------------------------------
 */

/**
 * Checks in an existing player from the directory to the session.
 * Automatically adds them to the end of the queue.
 */
export const checkInPlayer = mutation({
  args: {
    sessionId: v.id("openPlaySessions"),
    playerId: v.id("players"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return { success: false, error: "Session not found." };
    }
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    const player = await ctx.db.get(args.playerId);
    if (!player) {
      return { success: false, error: "Player not found." };
    }
    if (player.tenantId !== session.tenantId) {
      return { success: false, error: "Player workspace mismatch." };
    }

    // Check if already checked in
    const existing = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_sessionId_and_playerId", (q) =>
        q.eq("sessionId", args.sessionId).eq("playerId", args.playerId)
      )
      .first();

    if (existing && existing.status !== "left") {
      return { success: false, error: "Player is already checked in to this session." };
    }

    const [queuePosition] = await allocateQueuePositions(ctx, args.sessionId);

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "queued",
        queuePosition,
        checkedInAt: Date.now(),
        ...INITIAL_ROTATION_METADATA,
      });
    } else {
      await ctx.db.insert("sessionPlayers", {
        sessionId: args.sessionId,
        playerId: args.playerId,
        status: "queued",
        queuePosition,
        checkedInAt: Date.now(),
        ...INITIAL_ROTATION_METADATA,
      });
    }

    return { success: true };
  },
});

/**
 * Registers a new player (guest/walk-in) and checks them in directly to the session.
 */
export const registerAndCheckInGuest = mutation({
  args: {
    tenantId: v.id("tenants"),
    sessionId: v.id("openPlaySessions"),
    firstName: v.string(),
    lastName: v.string(),
    skillTier: v.union(
      v.literal("Beginner"),
      v.literal("Novice"),
      v.literal("Low Intermediate"),
      v.literal("High Intermediate"),
      v.literal("Advanced")
    ),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    gender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return { success: false, error: "Session not found." };
    }
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    if (session.tenantId !== args.tenantId) {
      return { success: false, error: "Session workspace mismatch." };
    }

    const firstName = requiredName(args.firstName);
    if (!firstName) return { success: false, error: "First name is required." };
    const lastName = requiredName(args.lastName);
    if (!lastName) return { success: false, error: "Last name is required." };

    // 1. Resolve or create Player
    const email = normalizeEmail(args.email);
    const phone = normalizePhone(args.phone);
    const legacyEmail = legacyContactValue(args.email);
    const legacyPhone = legacyContactValue(args.phone);

    const player = await findPlayerByContact(ctx, args.tenantId, {
      email,
      phone,
      legacyEmail,
      legacyPhone,
    });

    let playerId: Id<"players">;
    if (player) {
      playerId = player._id;
    } else {
      playerId = await ctx.db.insert("players", {
        tenantId: args.tenantId,
        firstName,
        lastName,
        skillSource: "manual",
        manualSkillLevel: args.skillTier,
        email,
        phone,
        gender: args.gender,
        createdAt: Date.now(),
      });
    }

    const existingSessionPlayer = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_sessionId_and_playerId", (q) =>
        q.eq("sessionId", args.sessionId).eq("playerId", playerId)
      )
      .first();

    if (existingSessionPlayer) {
      if (existingSessionPlayer.status !== "left") {
        return { success: false, error: "Player is already checked in to this session." };
      }
    }

    // 2. Check in the player
    const [queuePosition] = await allocateQueuePositions(ctx, args.sessionId);

    if (existingSessionPlayer) {
      await ctx.db.patch(existingSessionPlayer._id, {
        status: "queued",
        queuePosition,
        checkedInAt: Date.now(),
        ...INITIAL_ROTATION_METADATA,
      });
    } else {
      await ctx.db.insert("sessionPlayers", {
        sessionId: args.sessionId,
        playerId,
        status: "queued",
        queuePosition,
        checkedInAt: Date.now(),
        ...INITIAL_ROTATION_METADATA,
      });
    }

    return { success: true, playerId };
  },
});

/**
 * Updates a player's status within the session (e.g. moving to sitting out or left).
 */
export const updatePlayerStatus = mutation({
  args: {
    sessionId: v.id("openPlaySessions"),
    playerId: v.id("players"),
    status: v.union(
      v.literal("checked_in"),
      v.literal("queued"),
      v.literal("playing"),
      v.literal("sitting_out"),
      v.literal("paused"),
      v.literal("left")
    ),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return { success: false, error: "Session not found." };
    }
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    const player = await ctx.db.get(args.playerId);
    if (!player) {
      return { success: false, error: "Player not found." };
    }
    if (player.tenantId !== session.tenantId) {
      return { success: false, error: "Player workspace mismatch." };
    }

    const record = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_sessionId_and_playerId", (q) =>
        q.eq("sessionId", args.sessionId).eq("playerId", args.playerId)
      )
      .first();

    if (!record) {
      return { success: false, error: "Player is not checked in to this session." };
    }

    if (args.status === "queued") {
      const [queuePosition] = await allocateQueuePositions(ctx, args.sessionId);
      await ctx.db.patch(record._id, { status: args.status, queuePosition });
    } else if (args.status === "sitting_out") {
      await ctx.db.patch(record._id, markPlayerSittingOut(record, Date.now()));
    } else {
      await ctx.db.patch(record._id, { status: args.status, queuePosition: undefined });
    }
    return { success: true };
  },
});

/**
 * Gets all players registered in the session along with their directory profiles.
 */
export const getSessionPlayers = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return { entries: [], truncated: false };
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);
    const list = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(501);

    const truncated = list.length > 500;
    const entries = await Promise.all(
      list.slice(0, 500).map(async (sp) => {
        const player = await ctx.db.get(sp.playerId);
        if (!player || player.tenantId !== session.tenantId) {
          return { ...sp, playerDetails: null }; // Tombstone or hidden details
        }
        return {
          ...sp,
          playerDetails: player,
        };
      })
    );
    return { entries, truncated };
  },
});


/**
 * ---------------------------------------------------------------------------
 * 3. MATCH MANAGEMENT & GENERATION
 * ---------------------------------------------------------------------------
 */

/**
 * Generates matches for empty courts in a session based on the active matching mode.
 */
export const generateMatches = mutation({
  args: {
    sessionId: v.id("openPlaySessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return { success: false, error: "Session not found." };
    }
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    if (session.status !== "live") {
      return { success: false, error: "Matches can only be generated for live sessions." };
    }

    // 1. Determine how many courts are available
    let totalCourts = 4; // Default fallback
    if (session.venueId) {
      const venue = await ctx.db.get(session.venueId);
      if (venue) {
        totalCourts = venue.courtCount;
      }
    }

    // Find all active (pending or in progress) matches to count occupied courts
    const activeMatches = [
      ...(await getSessionMatchesByStatus(ctx, args.sessionId, "pending")),
      ...(await getSessionMatchesByStatus(ctx, args.sessionId, "in_progress")),
    ];

    const occupiedCourtsCount = activeMatches.length;
    const availableCourtsCount = totalCourts - occupiedCourtsCount;

    if (availableCourtsCount <= 0) {
      return { success: true, message: "All courts are currently occupied." };
    }

    // 2. Identify available players (status = "queued" or "sitting_out")
    // and not currently playing in any active match
    const sessionPlayers = [
      ...(await ctx.db
        .query("sessionPlayers")
        .withIndex("by_sessionId_and_status_and_queuePosition", (q) =>
          q.eq("sessionId", args.sessionId).eq("status", "queued")
        )
        .order("asc")
        .collect()),
      ...(await ctx.db
        .query("sessionPlayers")
        .withIndex("by_sessionId_and_status", (q) =>
          q.eq("sessionId", args.sessionId).eq("status", "sitting_out")
        )
        .collect()),
    ];

    const playingPlayerIds = new Set<string>();
    for (const m of activeMatches) {
      m.team1.forEach((id) => playingPlayerIds.add(id));
      m.team2.forEach((id) => playingPlayerIds.add(id));
    }

    const availableSessionPlayers = sessionPlayers.filter(
      (sp) =>
        (sp.status === "queued" || sp.status === "sitting_out") &&
        !playingPlayerIds.has(sp.playerId)
    );

    const sortedAvailable = [...availableSessionPlayers].sort(compareRotationPriority);

    const assignableSessionPlayers = sortedAvailable.slice(0, availableCourtsCount * 4);

    if (assignableSessionPlayers.length < 4) {
      return { success: false, error: "Not enough players available to generate a match (need at least 4)." };
    }

    // Load actual player detail documents to perform smart matching
    const loadedPlayers = await Promise.all(
      assignableSessionPlayers.map(async (sp) => {
        const details = await ctx.db.get(sp.playerId);
        return {
          sessionPlayer: sp,
          details,
          skillVal: details
            ? SKILL_MAP[details.manualSkillLevel] || 3.0
            : 3.0,
        };
      })
    );

    // We can generate up to `availableCourtsCount` matches
    const matchesCreated: Id<"sessionMatches">[] = [];
    const selectedSessionPlayerIds = new Set<string>();
    const generationTime = Date.now();
    let playerIndex = 0;

    for (let court = 0; court < availableCourtsCount; court++) {
      if (loadedPlayers.length - playerIndex < 4) {
        break; // Not enough remaining players
      }

      // Take the next 4 players from the sorted queue
      const candidates = loadedPlayers.slice(playerIndex, playerIndex + 4);
      playerIndex += 4;

      // Apply matching mode logic to pair these 4 players
      let team1: Id<"players">[] = [];
      let team2: Id<"players">[] = [];

      if (session.matchingMode === "auto_balanced") {
        // Sort the 4 candidates by skill rating descending
        const sortedCandidates = [...candidates].sort((a, b) => b.skillVal - a.skillVal);
        // Team 1: Highest (0) + Lowest (3)
        // Team 2: Middle two (1) + (2)
        team1 = [sortedCandidates[0].sessionPlayer.playerId, sortedCandidates[3].sessionPlayer.playerId];
        team2 = [sortedCandidates[1].sessionPlayer.playerId, sortedCandidates[2].sessionPlayer.playerId];
      } else if (session.matchingMode === "mixed_doubles") {
        // Try to balance by gender if available
        const males = candidates.filter((c) => c.details?.gender?.toLowerCase() === "male");
        const females = candidates.filter((c) => c.details?.gender?.toLowerCase() === "female");

        if (males.length >= 2 && females.length >= 2) {
          team1 = [males[0].sessionPlayer.playerId, females[0].sessionPlayer.playerId];
          team2 = [males[1].sessionPlayer.playerId, females[1].sessionPlayer.playerId];
        } else {
          // Fallback to simple split
          team1 = [candidates[0].sessionPlayer.playerId, candidates[1].sessionPlayer.playerId];
          team2 = [candidates[2].sessionPlayer.playerId, candidates[3].sessionPlayer.playerId];
        }
      } else {
        // Default / skill-separated / standard queue: simple split
        // For skill-separated, the queue is already grouped if we enforce skill courts,
        // but here we do a standard split.
        team1 = [candidates[0].sessionPlayer.playerId, candidates[1].sessionPlayer.playerId];
        team2 = [candidates[2].sessionPlayer.playerId, candidates[3].sessionPlayer.playerId];
      }

      // Insert match into DB
      const courtNumber = occupiedCourtsCount + matchesCreated.length + 1;
      const matchId = await ctx.db.insert("sessionMatches", {
        sessionId: args.sessionId,
        courtName: `Court ${courtNumber}`,
        team1,
        team2,
        status: "in_progress",
        createdAt: generationTime,
      });

      // Update statuses of the 4 players to 'playing' and remove from queue pos
      for (const player of candidates) {
        selectedSessionPlayerIds.add(player.sessionPlayer._id);
        await ctx.db.patch(
          player.sessionPlayer._id,
          markPlayerPlaying(player.sessionPlayer, generationTime)
        );
      }

      matchesCreated.push(matchId);
    }

    const skippedPlayers = availableSessionPlayers.filter(
      (player) => !selectedSessionPlayerIds.has(player._id)
    );
    await Promise.all(
      skippedPlayers.map((player) =>
        ctx.db.patch(player._id, markPlayerSittingOut(player, generationTime))
      )
    );

    return {
      success: true,
      message: `Successfully generated ${matchesCreated.length} matches.`,
      matches: matchesCreated,
    };
  },
});

/**
 * Records score for an open play match, moves players back to the queue, and logs the result.
 */
export const recordMatchScore = mutation({
  args: {
    matchId: v.id("sessionMatches"),
    score1: v.number(),
    score2: v.number(),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) {
      return { success: false, error: "Match not found." };
    }

    const session = await ctx.db.get(match.sessionId);
    if (!session) {
      return { success: false, error: "Associated session not found." };
    }
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    if (match.status === "completed") {
      return { success: false, error: "Match is already completed." };
    }
    if (match.status === "cancelled") {
      return { success: false, error: "Cannot record a score on a cancelled match." };
    }
    if (args.score1 < 0 || args.score2 < 0) {
      return { success: false, error: "Scores cannot be negative." };
    }
    if (args.score1 === args.score2) {
      return { success: false, error: "Tied scores are not supported." };
    }

    // 1. Update the match document
    await ctx.db.patch(args.matchId, {
      score1: args.score1,
      score2: args.score2,
      status: "completed",
      completedAt: Date.now(),
    });

    // 2. Insert into Match History. The reference rows in
    // `matchHistoryParticipants` (Phase 3.2) let the bounded delete
    // blocker find a player's matches via a scalar index instead of
    // scanning the `players` array. We dedupe first so re-runs of the
    // mutation don't double-insert.
    const winners = args.score1 > args.score2 ? match.team1 : match.team2;
    const matchHistoryId = await ctx.db.insert("matchHistory", {
      tenantId: session.tenantId,
      sessionId: session._id,
      players: [...match.team1, ...match.team2],
      scores: [args.score1, args.score2],
      winners,
      playedAt: Date.now(),
    });
    for (const playerId of [...match.team1, ...match.team2]) {
      await ctx.db.insert("matchHistoryParticipants", {
        matchHistoryId,
        tenantId: session.tenantId,
        playerId,
      });
    }

    // 3. Update player stats snapshots (wins, losses, points)
    const updateStats = async (pId: Id<"players">, isWin: boolean, ptsFor: number, ptsAgainst: number) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const snapshotDate = today.getTime();

      const existing = await ctx.db
        .query("statsSnapshots")
        .withIndex("by_playerId_and_snapshotDate", (q) =>
          q.eq("playerId", pId).eq("snapshotDate", snapshotDate)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          wins: existing.wins + (isWin ? 1 : 0),
          losses: existing.losses + (isWin ? 0 : 1),
          pointsFor: existing.pointsFor + ptsFor,
          pointsAgainst: existing.pointsAgainst + ptsAgainst,
        });
      } else {
        await ctx.db.insert("statsSnapshots", {
          tenantId: session.tenantId,
          playerId: pId,
          wins: isWin ? 1 : 0,
          losses: isWin ? 0 : 1,
          pointsFor: ptsFor,
          pointsAgainst: ptsAgainst,
          snapshotDate,
        });
      }
    };

    // Update stats for Team 1
    const t1Win = args.score1 > args.score2;
    for (const pId of match.team1) {
      await updateStats(pId, t1Win, args.score1, args.score2);
    }
    // Update stats for Team 2
    const t2Win = args.score2 > args.score1;
    for (const pId of match.team2) {
      await updateStats(pId, t2Win, args.score2, args.score1);
    }

    // 4. Return players to queue (status: queued) and append to end
    // Return players to the queue in a consistent order: losers first, then winners
    // (This is a nice UX touch that rewards winners with a break or gets losers back on court faster)
    const losers = t1Win ? match.team2 : match.team1;
    const wonList = t1Win ? match.team1 : match.team2;
    const returnOrder = [...losers, ...wonList];

    const sessionPlayerRecords = [];
    for (const pId of returnOrder) {
      const spRecord = await ctx.db
        .query("sessionPlayers")
        .withIndex("by_sessionId_and_playerId", (q) =>
          q.eq("sessionId", match.sessionId).eq("playerId", pId)
        )
        .first();
      if (spRecord) {
        sessionPlayerRecords.push(spRecord);
      }
    }

    const queuePositions = await allocateQueuePositions(ctx, match.sessionId, sessionPlayerRecords.length);
    for (let index = 0; index < sessionPlayerRecords.length; index++) {
      await ctx.db.patch(sessionPlayerRecords[index]._id, {
        status: "queued",
        queuePosition: queuePositions[index],
      });
    }

    return { success: true };
  },
});

/**
 * Gets all matches currently live or pending in a session.
 */
export const getLiveMatches = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return { entries: [], truncated: false };
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    // Bounded queries
    const pending = await getSessionMatchesByStatus(ctx, args.sessionId, "pending", 51);
    const inProgress = await getSessionMatchesByStatus(ctx, args.sessionId, "in_progress", 51);

    let active = [...pending, ...inProgress];
    const truncated = active.length > 50;
    active = active.slice(0, 50);

    const entries = await Promise.all(
      active.map(async (m) => {
        const team1Details = await Promise.all(
          m.team1.map(async (id: Id<"players">) => {
            const p = await ctx.db.get(id);
            if (!p || p.tenantId !== session.tenantId) return null;
            return p;
          })
        );
        const team2Details = await Promise.all(
          m.team2.map(async (id: Id<"players">) => {
            const p = await ctx.db.get(id);
            if (!p || p.tenantId !== session.tenantId) return null;
            return p;
          })
        );
        return {
          ...m,
          team1Details,
          team2Details,
        };
      })
    );
    return { entries, truncated };
  },
});

/**
 * Gets historical completed AND cancelled matches for a session, sorted
 * newest-first. Cancelled matches surface here (not in getLiveMatches) so the
 * Game Master retains a visible audit trail per cancelMatch's contract.
 */
export const getMatchHistory = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return { entries: [], truncated: false };
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    const completed = await getSessionMatchesByStatus(ctx, args.sessionId, "completed", 51, "desc");
    const cancelled = await getSessionMatchesByStatus(ctx, args.sessionId, "cancelled", 51, "desc");

    let historical = [...completed, ...cancelled].sort(
      (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)
    );
    const truncated = historical.length > 50;
    historical = historical.slice(0, 50);

    const entries = await Promise.all(
      historical.map(async (m) => {
        const team1Details = await Promise.all(
          m.team1.map(async (id: Id<"players">) => {
            const p = await ctx.db.get(id);
            if (!p || p.tenantId !== session.tenantId) return null;
            return p;
          })
        );
        const team2Details = await Promise.all(
          m.team2.map(async (id: Id<"players">) => {
            const p = await ctx.db.get(id);
            if (!p || p.tenantId !== session.tenantId) return null;
            return p;
          })
        );
        return {
          ...m,
          team1Details,
          team2Details,
        };
      })
    );
    return { entries, truncated };
  },
});

/**
 * ---------------------------------------------------------------------------
 * 4. MATCH ADJUSTMENT (Game Master courtside controls)
 * ---------------------------------------------------------------------------
 */

/**
 * Renames the court for a pending or in-progress match.
 */
export const updateMatchCourt = mutation({
  args: {
    matchId: v.id("sessionMatches"),
    courtName: v.string(),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) {
      return { success: false, error: "Match not found." };
    }
    const session = await ctx.db.get(match.sessionId);
    if (!session) {
      return { success: false, error: "Associated session not found." };
    }
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    if (match.status === "completed" || match.status === "cancelled") {
      return { success: false, error: "Cannot rename a completed or cancelled match." };
    }
    const courtName = args.courtName.trim() || undefined;
    await ctx.db.patch(args.matchId, { courtName });
    return { success: true };
  },
});

/**
 * Swaps two players between teams within the same active match.
 * Both playerAId and playerBId must be in this match (either team).
 * They must be on different teams — swapping within the same team is a no-op.
 */
export const swapMatchPlayers = mutation({
  args: {
    matchId: v.id("sessionMatches"),
    playerAId: v.id("players"),
    playerBId: v.id("players"),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) {
      return { success: false, error: "Match not found." };
    }
    const session = await ctx.db.get(match.sessionId);
    if (!session) {
      return { success: false, error: "Associated session not found." };
    }
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    if (match.status === "completed" || match.status === "cancelled") {
      return { success: false, error: "Cannot adjust a completed or cancelled match." };
    }
    if (args.playerAId === args.playerBId) {
      return { success: false, error: "Cannot swap a player with themselves." };
    }

    const aInTeam1 = match.team1.includes(args.playerAId);
    const aInTeam2 = match.team2.includes(args.playerAId);
    const bInTeam1 = match.team1.includes(args.playerBId);
    const bInTeam2 = match.team2.includes(args.playerBId);

    if (!aInTeam1 && !aInTeam2) {
      return { success: false, error: "Player A is not in this match." };
    }
    if (!bInTeam1 && !bInTeam2) {
      return { success: false, error: "Player B is not in this match." };
    }
    // Same-team swap is a no-op per the docstring — return success without
    // a DB write.
    if ((aInTeam1 && bInTeam1) || (aInTeam2 && bInTeam2)) {
      return { success: true };
    }

    // Build new teams with A and B positions swapped
    const newTeam1 = match.team1.map((id) => {
      if (id === args.playerAId) return args.playerBId;
      if (id === args.playerBId) return args.playerAId;
      return id;
    });
    const newTeam2 = match.team2.map((id) => {
      if (id === args.playerAId) return args.playerBId;
      if (id === args.playerBId) return args.playerAId;
      return id;
    });

    // Ensure 4 unique player IDs still
    const allIds = [...newTeam1, ...newTeam2];
    if (new Set(allIds).size !== allIds.length) {
      return { success: false, error: "Swap would result in duplicate players in the match." };
    }

    await ctx.db.patch(args.matchId, { team1: newTeam1, team2: newTeam2 });
    return { success: true };
  },
});

/**
 * Substitutes a queued or sitting-out player into an active match, replacing an outgoing player.
 * - Outgoing player must be in the match (team1 or team2).
 * - Incoming player must be in the same session, with status "queued" or "sitting_out".
 * - Incoming player must NOT already be playing in any active match.
 * - The match must not have scores recorded yet.
 * - After substitution: incoming → "playing"; outgoing → front of queue.
 */
export const substituteMatchPlayer = mutation({
  args: {
    matchId: v.id("sessionMatches"),
    outgoingPlayerId: v.id("players"),
    incomingPlayerId: v.id("players"),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) {
      return { success: false, error: "Match not found." };
    }
    const session = await ctx.db.get(match.sessionId);
    if (!session) {
      return { success: false, error: "Associated session not found." };
    }
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    if (args.outgoingPlayerId === args.incomingPlayerId) {
      return { success: false, error: "Outgoing and incoming player cannot be the same." };
    }
    if (match.status === "completed" || match.status === "cancelled") {
      return { success: false, error: "Cannot substitute in a completed or cancelled match." };
    }
    if (match.score1 != null || match.score2 != null) {
      return { success: false, error: "Cannot substitute after scoring has begun." };
    }

    // Outgoing must be in this match
    const outInTeam1 = match.team1.includes(args.outgoingPlayerId);
    const outInTeam2 = match.team2.includes(args.outgoingPlayerId);
    if (!outInTeam1 && !outInTeam2) {
      return { success: false, error: "Outgoing player is not in this match." };
    }

    // Incoming must be checked into this session with eligible status
    const incomingSP = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_sessionId_and_playerId", (q) =>
        q.eq("sessionId", match.sessionId).eq("playerId", args.incomingPlayerId)
      )
      .first();

    if (!incomingSP) {
      return { success: false, error: "Incoming player is not checked into this session." };
    }
    if (incomingSP.status !== "queued" && incomingSP.status !== "sitting_out") {
      return { success: false, error: "Incoming player must be queued or sitting out." };
    }

    // Check incoming is not already in another active match
    const [pendingMatches, inProgressMatches] = await Promise.all([
      getSessionMatchesByStatus(ctx, match.sessionId, "pending"),
      getSessionMatchesByStatus(ctx, match.sessionId, "in_progress"),
    ]);
    for (const activeMatch of [...pendingMatches, ...inProgressMatches]) {
      if (activeMatch._id === match._id) continue; // the current match
      if (
        activeMatch.team1.includes(args.incomingPlayerId) ||
        activeMatch.team2.includes(args.incomingPlayerId)
      ) {
        return { success: false, error: "Incoming player is already assigned to another active match." };
      }
    }

    // Build updated teams
    const newTeam1 = match.team1.map((id) =>
      id === args.outgoingPlayerId ? args.incomingPlayerId : id
    );
    const newTeam2 = match.team2.map((id) =>
      id === args.outgoingPlayerId ? args.incomingPlayerId : id
    );

    // Validate no duplicates in new roster
    const allIds = [...newTeam1, ...newTeam2];
    if (new Set(allIds).size !== allIds.length) {
      return { success: false, error: "Substitution would result in duplicate players in the match." };
    }

    // Look up outgoing and allocate front position in parallel (independent reads).
    const [outgoingSP, [frontPosition]] = await Promise.all([
      ctx.db
        .query("sessionPlayers")
        .withIndex("by_sessionId_and_playerId", (q) =>
          q.eq("sessionId", match.sessionId).eq("playerId", args.outgoingPlayerId)
        )
        .first(),
      allocateFrontQueuePositions(ctx, match.sessionId, 1),
    ]);

    // Apply the three independent writes in a single transaction batch.
    const substitutionTime = Date.now();
    const writes: Promise<unknown>[] = [
      ctx.db.patch(args.matchId, { team1: newTeam1, team2: newTeam2 }),
      ctx.db.patch(incomingSP._id, markPlayerPlaying(incomingSP, substitutionTime)),
    ];
    if (outgoingSP) {
      writes.push(
        ctx.db.patch(outgoingSP._id, { status: "queued", queuePosition: frontPosition })
      );
    }
    await Promise.all(writes);

    return { success: true };
  },
});

/**
 * Cancels an unscored, non-completed match.
 * - Only pending/in_progress matches with no scores can be cancelled.
 * - All four players return to the front of the queue in their original assignment order.
 * - The match is retained in DB as a historical record with status "cancelled".
 */
export const cancelMatch = mutation({
  args: {
    matchId: v.id("sessionMatches"),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) {
      return { success: false, error: "Match not found." };
    }
    const session = await ctx.db.get(match.sessionId);
    if (!session) {
      return { success: false, error: "Associated session not found." };
    }
    await requireRole(ctx, session.tenantId, ["owner", "game_master"]);

    if (match.status === "completed") {
      return { success: false, error: "Cannot cancel a completed match." };
    }
    if (match.status === "cancelled") {
      return { success: false, error: "Match is already cancelled." };
    }
    if (match.score1 != null || match.score2 != null) {
      return { success: false, error: "Cannot cancel a match that already has scores recorded." };
    }

    // Players return to front in original pull order: team1[0], team1[1], team2[0], team2[1].
    // sortSessionPlayers sorts ascending by queuePosition, so the first player in the
    // pull order (team1[0]) must receive the smallest position. allocateFrontQueuePositions
    // returns positions in descending order ([start, start-1, ...]); we reverse so that
    // team1[0] gets start-N+1 (smallest) and team2[1] gets start (largest).
    const playerIds = [...match.team1, ...match.team2];

    // Gather sessionPlayer records in parallel
    const spRecords = (
      await Promise.all(
        playerIds.map((pId) =>
          ctx.db
            .query("sessionPlayers")
            .withIndex("by_sessionId_and_playerId", (q) =>
              q.eq("sessionId", match.sessionId).eq("playerId", pId)
            )
            .first()
        )
      )
    ).filter((sp): sp is NonNullable<typeof sp> => sp !== null);

    const ascendingPositions = await allocateFrontQueuePositions(
      ctx,
      match.sessionId,
      spRecords.length
    );
    const positions = [...ascendingPositions].reverse();

    await Promise.all(
      spRecords.map((sp, i) =>
        ctx.db.patch(sp._id, {
          status: "queued",
          queuePosition: positions[i],
        })
      )
    );

    // Mark match as cancelled (retained for history). Set completedAt so
    // getMatchHistory's newest-first sort treats cancellations the same as
    // completed matches.
    await ctx.db.patch(args.matchId, { status: "cancelled", completedAt: Date.now() });

    return { success: true };
  },
});


/**
 * ---------------------------------------------------------------------------
 * PUBLIC PROJECTIONS (Safe for unauthenticated / player reads)
 * ---------------------------------------------------------------------------
 */
export const getPublicSession = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status === "draft") return null;

    const tenant = await ctx.db.get(session.tenantId);
    if (!tenant || tenant.status !== "active") return null;

    return {
      _id: session._id, name: session.name, date: session.date, status: session.status, matchingMode: session.matchingMode,
    };
  },
});
export const getPublicSessionPlayers = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status === "draft") return { entries: [], truncated: false };

    const tenant = await ctx.db.get(session.tenantId);
    if (!tenant || tenant.status !== "active") return { entries: [], truncated: false };

    const list = await ctx.db.query("sessionPlayers").withIndex("by_session", (q) => q.eq("sessionId", args.sessionId)).take(101);
    const truncated = list.length > 100;

    const result = [];
    for (const sp of list.slice(0, 100)) {
      const player = await ctx.db.get(sp.playerId);
      if (player && player.tenantId === session.tenantId) {
        // Project only the rotation/queue fields the public view needs to
        // sort the queue, render queue labels, and show rotation stats —
        // never email/phone/notes/username (private player fields).
        result.push({
          _id: sp._id,
          status: sp.status,
          queuePosition: sp.queuePosition,
          checkedInAt: sp.checkedInAt,
          matchesPlayed: sp.matchesPlayed,
          sitOutCount: sp.sitOutCount,
          consecutiveSitOuts: sp.consecutiveSitOuts,
          lastPlayedAt: sp.lastPlayedAt,
          lastSatOutAt: sp.lastSatOutAt,
          playerDetails: {
            firstName: player.firstName,
            lastName: player.lastName,
            manualSkillLevel: player.manualSkillLevel,
            profileImageUrl: player.avatarUrl,
            rating: player.duprRating,
          },
        });
      }
    }
    return { entries: result, truncated };
  },
});

export const getPublicLiveMatches = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status === "draft") return { entries: [], truncated: false };

    const tenant = await ctx.db.get(session.tenantId);
    if (!tenant || tenant.status !== "active") return { entries: [], truncated: false };

    const pending = await getSessionMatchesByStatus(ctx, args.sessionId, "pending", 51);
    const inProgress = await getSessionMatchesByStatus(ctx, args.sessionId, "in_progress", 51);

    let active = [...pending, ...inProgress];
    const truncated = active.length > 50;
    active = active.slice(0, 50);

    const entries = await Promise.all(
      active.map(async (m) => {
        const team1Details = await Promise.all(m.team1.map(async (id: Id<"players">) => {
          const p = await ctx.db.get(id);
          if (!p || p.tenantId !== session.tenantId) return null;
          return { firstName: p.firstName, lastName: p.lastName, profileImageUrl: p.avatarUrl, manualSkillLevel: p.manualSkillLevel };
        }));
        const team2Details = await Promise.all(m.team2.map(async (id: Id<"players">) => {
          const p = await ctx.db.get(id);
          if (!p || p.tenantId !== session.tenantId) return null;
          return { firstName: p.firstName, lastName: p.lastName, profileImageUrl: p.avatarUrl, manualSkillLevel: p.manualSkillLevel };
        }));
        return { _id: m._id, courtName: m.courtName, status: m.status, team1Details: team1Details.filter(p => p !== null), team2Details: team2Details.filter(p => p !== null), };
      })
    );
    return { entries, truncated };
  },
});
export const getPublicMatchHistory = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status === "draft") return { entries: [], truncated: false };

    const tenant = await ctx.db.get(session.tenantId);
    if (!tenant || tenant.status !== "active") return { entries: [], truncated: false };

    // Public history exposes COMPLETED matches only. Cancelled matches
    // are an administrative audit trail (see `cancelMatch` and the admin
    // `getMatchHistory`) and must not be surfaced to unauthenticated
    // viewers. Sorting is already newest-first from the index scan.
    const completed = await getSessionMatchesByStatus(ctx, args.sessionId, "completed", 51, "desc");

    const truncated = completed.length > 50;
    const historical = completed.slice(0, 50);

    const entries = await Promise.all(
      historical.map(async (m) => {
        const team1Details = await Promise.all(m.team1.map(async (id: Id<"players">) => {
          const p = await ctx.db.get(id);
          if (!p || p.tenantId !== session.tenantId) return null;
          return { firstName: p.firstName, lastName: p.lastName, profileImageUrl: p.avatarUrl, manualSkillLevel: p.manualSkillLevel };
        }));
        const team2Details = await Promise.all(m.team2.map(async (id: Id<"players">) => {
          const p = await ctx.db.get(id);
          if (!p || p.tenantId !== session.tenantId) return null;
          return { firstName: p.firstName, lastName: p.lastName, profileImageUrl: p.avatarUrl, manualSkillLevel: p.manualSkillLevel };
        }));
        return { _id: m._id, courtName: m.courtName, status: m.status, score1: m.score1, score2: m.score2, team1Details: team1Details.filter(p => p !== null), team2Details: team2Details.filter(p => p !== null), };
      })
    );
    return { entries, truncated };
  },
});
