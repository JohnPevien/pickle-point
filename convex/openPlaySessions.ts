import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Skill mapping for numerical comparison and balancing
const SKILL_MAP: Record<string, number> = {
  "Beginner": 1.0,
  "Novice": 2.0,
  "Low Intermediate": 3.0,
  "High Intermediate": 4.0,
  "Advanced": 5.0,
};

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
    tenantId: v.id("tenants"),
    venueId: v.optional(v.id("venues")),
    name: v.string(),
    date: v.number(),
    matchingMode: v.union(
      v.literal("auto_balanced"),
      v.literal("skill_separated"),
      v.literal("winners_vs_losers"),
      v.literal("mixed_doubles"),
      v.literal("skill_courts")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("openPlaySessions", {
      tenantId: args.tenantId,
      venueId: args.venueId,
      name: args.name,
      date: args.date,
      status: "draft",
      matchingMode: args.matchingMode,
      createdAt: Date.now(),
    });
  },
});

/**
 * Lists all open play sessions for a given tenant.
 */
export const listByTenant = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("openPlaySessions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .collect();
  },
});

/**
 * Gets a single open play session by ID.
 */
export const getById = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

/**
 * Updates a session's lifecycle status.
 */
export const updateSessionStatus = mutation({
  args: {
    sessionId: v.id("openPlaySessions"),
    status: v.union(
      v.literal("draft"),
      v.literal("check_in"),
      v.literal("live"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, args) => {
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
    matchingMode: v.union(
      v.literal("auto_balanced"),
      v.literal("skill_separated"),
      v.literal("winners_vs_losers"),
      v.literal("mixed_doubles"),
      v.literal("skill_courts")
    ),
  },
  handler: async (ctx, args) => {
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

    // Determine queue position (max + 1)
    const queuedPlayers = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_sessionId_and_status", (q) =>
        q.eq("sessionId", args.sessionId).eq("status", "queued")
      )
      .collect();

    const maxPos = queuedPlayers.reduce(
      (max, p) => Math.max(max, p.queuePosition ?? 0),
      0
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "queued",
        queuePosition: maxPos + 1,
        checkedInAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sessionPlayers", {
        sessionId: args.sessionId,
        playerId: args.playerId,
        status: "queued",
        queuePosition: maxPos + 1,
        checkedInAt: Date.now(),
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
    // 1. Resolve or create Player
    const email = args.email?.trim() || undefined;
    const phone = args.phone?.trim() || undefined;

    let player = null;
    if (email) {
      player = await ctx.db
        .query("players")
        .withIndex("by_tenantId_and_email", (q) =>
          q.eq("tenantId", args.tenantId).eq("email", email)
        )
        .first();
    }
    if (!player && phone) {
      player = await ctx.db
        .query("players")
        .withIndex("by_tenantId_and_phone", (q) =>
          q.eq("tenantId", args.tenantId).eq("phone", phone)
        )
        .first();
    }

    let playerId: Id<"players">;
    if (player) {
      playerId = player._id;
    } else {
      playerId = await ctx.db.insert("players", {
        tenantId: args.tenantId,
        firstName: args.firstName.trim(),
        lastName: args.lastName.trim(),
        skillSource: "manual",
        manualSkillLevel: args.skillTier,
        email,
        phone,
        gender: args.gender,
        createdAt: Date.now(),
      });
    }

    // 2. Check in the player
    // Determine queue position (max + 1)
    const queuedPlayers = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_sessionId_and_status", (q) =>
        q.eq("sessionId", args.sessionId).eq("status", "queued")
      )
      .collect();

    const maxPos = queuedPlayers.reduce(
      (max, p) => Math.max(max, p.queuePosition ?? 0),
      0
    );

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
      await ctx.db.patch(existingSessionPlayer._id, {
        status: "queued",
        queuePosition: maxPos + 1,
        checkedInAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sessionPlayers", {
        sessionId: args.sessionId,
        playerId,
        status: "queued",
        queuePosition: maxPos + 1,
        checkedInAt: Date.now(),
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
      v.literal("left")
    ),
  },
  handler: async (ctx, args) => {
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
      const queuedPlayers = await ctx.db
        .query("sessionPlayers")
        .withIndex("by_sessionId_and_status", (q) =>
          q.eq("sessionId", args.sessionId).eq("status", "queued")
        )
        .collect();
      const maxPos = queuedPlayers.reduce(
        (max, p) => Math.max(max, p.queuePosition ?? 0),
        0
      );
      await ctx.db.patch(record._id, { status: args.status, queuePosition: maxPos + 1 });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id, _creationTime, queuePosition: _qp, ...rest } = record;
      await ctx.db.replace(record._id, { ...rest, status: args.status });
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
    const list = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return await Promise.all(
      list.map(async (sp) => {
        const player = await ctx.db.get(sp.playerId);
        return {
          ...sp,
          playerDetails: player,
        };
      })
    );
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

    // 1. Determine how many courts are available
    let totalCourts = 4; // Default fallback
    if (session.venueId) {
      const venue = await ctx.db.get(session.venueId);
      if (venue) {
        totalCourts = venue.courtCount;
      }
    }

    // Find all active (pending or in progress) matches to count occupied courts
    const activeMatches = await ctx.db
      .query("sessionMatches")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()
      .then((matches) =>
        matches.filter((m) => m.status === "pending" || m.status === "in_progress")
      );

    const occupiedCourtsCount = activeMatches.length;
    const availableCourtsCount = totalCourts - occupiedCourtsCount;

    if (availableCourtsCount <= 0) {
      return { success: true, message: "All courts are currently occupied." };
    }

    // 2. Identify available players (status = "queued" or "sitting_out")
    // and not currently playing in any active match
    const sessionPlayers = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

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

    // Sort available players by queue position (players waiting longest first)
    // Players with status 'queued' are prioritized by queuePosition.
    // 'sitting_out' players have no queuePosition, so they go to the back.
    const sortedAvailable = [...availableSessionPlayers].sort((a, b) => {
      if (a.status === "queued" && b.status === "queued") {
        return (a.queuePosition ?? 0) - (b.queuePosition ?? 0);
      }
      if (a.status === "queued") return -1;
      if (b.status === "queued") return 1;
      return a.checkedInAt - b.checkedInAt;
    });

    if (sortedAvailable.length < 4) {
      return { success: false, error: "Not enough players in queue to generate a match (need at least 4)." };
    }

    // Load actual player detail documents to perform smart matching
    const loadedPlayers = await Promise.all(
      sortedAvailable.map(async (sp) => {
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
        createdAt: Date.now(),
      });

      // Update statuses of the 4 players to 'playing' and remove from queue pos
      const allPlayerIds = [...team1, ...team2];
      for (const pId of allPlayerIds) {
        const spRecord = sessionPlayers.find((sp) => sp.playerId === pId);
        if (spRecord) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { _id, _creationTime, queuePosition: _qp, ...rest } = spRecord;
          await ctx.db.replace(spRecord._id, { ...rest, status: "playing" });
        }
      }

      matchesCreated.push(matchId);
    }

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
    if (match.status === "completed") {
      return { success: false, error: "Match is already completed." };
    }

    const session = await ctx.db.get(match.sessionId);
    if (!session) {
      return { success: false, error: "Associated session not found." };
    }

    // 1. Update the match document
    await ctx.db.patch(args.matchId, {
      score1: args.score1,
      score2: args.score2,
      status: "completed",
      completedAt: Date.now(),
    });

    // 2. Insert into Match History
    const winners = args.score1 > args.score2 ? match.team1 : match.team2;
    await ctx.db.insert("matchHistory", {
      tenantId: session.tenantId,
      sessionId: session._id,
      players: [...match.team1, ...match.team2],
      scores: [args.score1, args.score2],
      winners,
      playedAt: Date.now(),
    });

    // 3. Update player stats snapshots (wins, losses, points)
    const updateStats = async (pId: Id<"players">, isWin: boolean, ptsFor: number, ptsAgainst: number) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const snapshotDate = today.getTime();

      const existing = await ctx.db
        .query("statsSnapshots")
        .withIndex("by_player", (q) => q.eq("playerId", pId))
        .collect()
        .then((snapshots) => snapshots.find((s) => s.snapshotDate === snapshotDate));

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
    const sessionPlayers = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", match.sessionId))
      .collect();

    // Get current max queue position
    const queuedPlayers = sessionPlayers.filter((sp) => sp.status === "queued");
    let currentMaxPos = queuedPlayers.reduce(
      (max, p) => Math.max(max, p.queuePosition ?? 0),
      0
    );

    // Return players to the queue in a consistent order: losers first, then winners
    // (This is a nice UX touch that rewards winners with a break or gets losers back on court faster)
    const losers = t1Win ? match.team2 : match.team1;
    const wonList = t1Win ? match.team1 : match.team2;
    const returnOrder = [...losers, ...wonList];

    for (const pId of returnOrder) {
      const spRecord = sessionPlayers.find((sp) => sp.playerId === pId);
      if (spRecord) {
        currentMaxPos += 1;
        await ctx.db.patch(spRecord._id, {
          status: "queued",
          queuePosition: currentMaxPos,
        });
      }
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
    const list = await ctx.db
      .query("sessionMatches")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const active = list.filter((m) => m.status === "pending" || m.status === "in_progress");

    return await Promise.all(
      active.map(async (m) => {
        const [team1Players, team2Players] = await Promise.all([
          Promise.all(m.team1.map((id) => ctx.db.get(id))),
          Promise.all(m.team2.map((id) => ctx.db.get(id))),
        ]);
        return {
          ...m,
          team1Details: team1Players,
          team2Details: team2Players,
        };
      })
    );
  },
});

/**
 * Gets historical completed matches for a session.
 */
export const getMatchHistory = query({
  args: { sessionId: v.id("openPlaySessions") },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("sessionMatches")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const completed = list
      .filter((m) => m.status === "completed")
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

    return await Promise.all(
      completed.map(async (m) => {
        const [team1Players, team2Players] = await Promise.all([
          Promise.all(m.team1.map((id) => ctx.db.get(id))),
          Promise.all(m.team2.map((id) => ctx.db.get(id))),
        ]);
        return {
          ...m,
          team1Details: team1Players,
          team2Details: team2Players,
        };
      })
    );
  },
});
