import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Helper validator for registering a single player
const playerInputValidator = v.object({
  firstName: v.string(),
  lastName: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  optIn: v.optional(v.boolean()),
});

/**
 * Lists all registered players within a Game Master's workspace.
 */
export const listByTenant = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("players")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .collect();
  },
});

/**
 * Registers a doubles team for a mini tournament.
 * Performs safe contact deduplication and tournament-specific registration validation.
 */
export const registerTournamentTeam = mutation({
  args: {
    tenantId: v.id("tenants"),
    tournamentId: v.id("tournaments"),
    teamName: v.string(),
    skillTier: v.union(
      v.literal("Beginner"),
      v.literal("Novice"),
      v.literal("Low Intermediate"),
      v.literal("High Intermediate"),
      v.literal("Advanced")
    ),
    player1: playerInputValidator,
    player2: playerInputValidator,
  },
  handler: async (ctx, args) => {
    // 1. Verify tournament exists and is open for registration
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      return { success: false, error: "Tournament not found." };
    }
    if (tournament.tenantId !== args.tenantId) {
      return { success: false, error: "Tournament workspace mismatch." };
    }
    if (tournament.status !== "registration_open") {
      return { success: false, error: "This tournament is not currently open for registration." };
    }

    // Helper to find a player by email or phone in this tenant
    const findExistingPlayer = async (email?: string, phone?: string) => {
      if (email) {
        const p = await ctx.db
          .query("players")
          .withIndex("by_tenantId_and_email", (q) => q.eq("tenantId", args.tenantId).eq("email", email))
          .first();
        if (p) return p;
      }
      if (phone) {
        const p = await ctx.db
          .query("players")
          .withIndex("by_tenantId_and_phone", (q) => q.eq("tenantId", args.tenantId).eq("phone", phone))
          .first();
        if (p) return p;
      }
      return null;
    };

    // Helper to see if a player is already registered for this tournament
    const isPlayerInTournament = async (playerId: Id<"players">) => {
      const p1Entrant = await ctx.db
        .query("tournamentEntrants")
        .withIndex("by_tournamentId_and_player1Id", (q) =>
          q.eq("tournamentId", args.tournamentId).eq("player1Id", playerId)
        )
        .first();
      if (p1Entrant) return true;

      const p2Entrant = await ctx.db
        .query("tournamentEntrants")
        .withIndex("by_tournamentId_and_player2Id", (q) =>
          q.eq("tournamentId", args.tournamentId).eq("player2Id", playerId)
        )
        .first();
      return !!p2Entrant;
    };

    // Resolve or create Player 1
    const p1Email = args.player1.email?.trim() || undefined;
    const p1Phone = args.player1.phone?.trim() || undefined;
    if (!p1Email && !p1Phone) {
      return { success: false, error: "Player 1 must have an email or phone number." };
    }

    const p1 = await findExistingPlayer(p1Email, p1Phone);
    let p1Id: Id<"players">;

    if (p1) {
      p1Id = p1._id;
      if (await isPlayerInTournament(p1Id)) {
        return { success: false, error: `${args.player1.firstName} is already registered for this tournament.` };
      }
    } else {
      p1Id = await ctx.db.insert("players", {
        tenantId: args.tenantId,
        firstName: args.player1.firstName.trim(),
        lastName: args.player1.lastName.trim(),
        skillSource: "manual",
        manualSkillLevel: args.skillTier,
        email: p1Email,
        phone: p1Phone,
        optIn: args.player1.optIn,
        createdAt: Date.now(),
      });
    }

    // Resolve or create Player 2
    const p2Email = args.player2.email?.trim() || undefined;
    const p2Phone = args.player2.phone?.trim() || undefined;
    if (!p2Email && !p2Phone) {
      return { success: false, error: "Player 2 must have an email or phone number." };
    }

    const p2 = await findExistingPlayer(p2Email, p2Phone);
    let p2Id: Id<"players">;

    if (p2) {
      p2Id = p2._id;
      if (await isPlayerInTournament(p2Id)) {
        return { success: false, error: `${args.player2.firstName} is already registered for this tournament.` };
      }
    } else {
      p2Id = await ctx.db.insert("players", {
        tenantId: args.tenantId,
        firstName: args.player2.firstName.trim(),
        lastName: args.player2.lastName.trim(),
        skillSource: "manual",
        manualSkillLevel: args.skillTier,
        email: p2Email,
        phone: p2Phone,
        optIn: args.player2.optIn,
        createdAt: Date.now(),
      });
    }

    // Create Tournament Entrant
    const entrantId = await ctx.db.insert("tournamentEntrants", {
      tournamentId: args.tournamentId,
      name: args.teamName.trim(),
      player1Id: p1Id,
      player2Id: p2Id,
      skillTier: args.skillTier,
      createdAt: Date.now(),
    });

    return { success: true, entrantId };
  },
});

const skillLevelValidator = v.union(
  v.literal("Beginner"),
  v.literal("Novice"),
  v.literal("Low Intermediate"),
  v.literal("High Intermediate"),
  v.literal("Advanced")
);

export const getById = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.playerId);
  },
});

export const createPlayer = mutation({
  args: {
    tenantId: v.id("tenants"),
    firstName: v.string(),
    lastName: v.string(),
    skillSource: v.union(v.literal("manual"), v.literal("dupr")),
    manualSkillLevel: skillLevelValidator,
    duprRating: v.optional(v.float64()),
    username: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    gender: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    optIn: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = args.email?.trim() || undefined;
    const phone = args.phone?.trim() || undefined;

    if (email) {
      const existing = await ctx.db
        .query("players")
        .withIndex("by_tenantId_and_email", (q) =>
          q.eq("tenantId", args.tenantId).eq("email", email)
        )
        .first();
      if (existing) {
        return { success: false, error: "A player with that email already exists in this workspace." };
      }
    }

    if (phone) {
      const existing = await ctx.db
        .query("players")
        .withIndex("by_tenantId_and_phone", (q) =>
          q.eq("tenantId", args.tenantId).eq("phone", phone)
        )
        .first();
      if (existing) {
        return { success: false, error: "A player with that phone number already exists in this workspace." };
      }
    }

    const playerId = await ctx.db.insert("players", {
      tenantId: args.tenantId,
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      skillSource: args.skillSource,
      manualSkillLevel: args.manualSkillLevel,
      duprRating: args.duprRating,
      username: args.username?.trim() || undefined,
      email,
      phone,
      gender: args.gender,
      avatarUrl: args.avatarUrl,
      notes: args.notes,
      optIn: args.optIn,
      createdAt: Date.now(),
    });

    return { success: true, playerId };
  },
});

export const updatePlayer = mutation({
  args: {
    playerId: v.id("players"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    skillSource: v.optional(v.union(v.literal("manual"), v.literal("dupr"))),
    manualSkillLevel: v.optional(skillLevelValidator),
    duprRating: v.optional(v.float64()),
    username: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    gender: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    optIn: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) {
      return { success: false, error: "Player not found." };
    }
    const { playerId, ...patch } = args;
    await ctx.db.patch(playerId, patch);
    return { success: true };
  },
});

export const deletePlayer = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) {
      return { success: false, error: "Player not found." };
    }
    await ctx.db.delete(args.playerId);
    return { success: true };
  },
});

export const getPlayerStats = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => {
    const snapshots = await ctx.db
      .query("statsSnapshots")
      .withIndex("by_player", (q) => q.eq("playerId", args.playerId))
      .collect();

    if (snapshots.length === 0) {
      return { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
    }

    return snapshots.reduce(
      (acc, s) => ({
        wins: acc.wins + s.wins,
        losses: acc.losses + s.losses,
        pointsFor: acc.pointsFor + s.pointsFor,
        pointsAgainst: acc.pointsAgainst + s.pointsAgainst,
      }),
      { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }
    );
  },
});
