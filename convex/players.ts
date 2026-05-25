import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  findPlayerByContact,
  legacyContactValue,
  normalizeEmail,
  normalizePhone,
} from "./playerContact";

// Helper validator for registering a single player
const playerInputValidator = v.object({
  firstName: v.string(),
  lastName: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  optIn: v.optional(v.boolean()),
});

function requiredName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

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

    const p1FirstName = requiredName(args.player1.firstName);
    if (!p1FirstName) return { success: false, error: "Player 1 first name is required." };
    const p1LastName = requiredName(args.player1.lastName);
    if (!p1LastName) return { success: false, error: "Player 1 last name is required." };
    const p2FirstName = requiredName(args.player2.firstName);
    if (!p2FirstName) return { success: false, error: "Player 2 first name is required." };
    const p2LastName = requiredName(args.player2.lastName);
    if (!p2LastName) return { success: false, error: "Player 2 last name is required." };

    const findExistingPlayer = async (
      email?: string,
      phone?: string,
      legacyEmail?: string,
      legacyPhone?: string
    ) => {
      return await findPlayerByContact(ctx, args.tenantId, {
        email,
        phone,
        legacyEmail,
        legacyPhone,
      });
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
    const p1Email = normalizeEmail(args.player1.email);
    const p1Phone = normalizePhone(args.player1.phone);
    const p1LegacyEmail = legacyContactValue(args.player1.email);
    const p1LegacyPhone = legacyContactValue(args.player1.phone);
    const p2Email = normalizeEmail(args.player2.email);
    const p2Phone = normalizePhone(args.player2.phone);
    const p2LegacyEmail = legacyContactValue(args.player2.email);
    const p2LegacyPhone = legacyContactValue(args.player2.phone);
    if (!p1Email && !p1Phone) {
      return { success: false, error: "Player 1 must have an email or phone number." };
    }
    if (!p2Email && !p2Phone) {
      return { success: false, error: "Player 2 must have an email or phone number." };
    }
    if ((p1Email && p1Email === p2Email) || (p1Phone && p1Phone === p2Phone)) {
      return { success: false, error: "A tournament team must contain two different players." };
    }

    const p1 = await findExistingPlayer(p1Email, p1Phone, p1LegacyEmail, p1LegacyPhone);
    let p1Id: Id<"players">;

    if (p1) {
      p1Id = p1._id;
      if (await isPlayerInTournament(p1Id)) {
        return { success: false, error: `${args.player1.firstName} is already registered for this tournament.` };
      }
    } else {
      p1Id = await ctx.db.insert("players", {
        tenantId: args.tenantId,
        firstName: p1FirstName,
        lastName: p1LastName,
        skillSource: "manual",
        manualSkillLevel: args.skillTier,
        email: p1Email,
        phone: p1Phone,
        optIn: args.player1.optIn,
        createdAt: Date.now(),
      });
    }

    // Resolve or create Player 2
    const p2 = await findExistingPlayer(p2Email, p2Phone, p2LegacyEmail, p2LegacyPhone);
    let p2Id: Id<"players">;

    if (p2) {
      p2Id = p2._id;
      if (await isPlayerInTournament(p2Id)) {
        return { success: false, error: `${args.player2.firstName} is already registered for this tournament.` };
      }
    } else {
      p2Id = await ctx.db.insert("players", {
        tenantId: args.tenantId,
        firstName: p2FirstName,
        lastName: p2LastName,
        skillSource: "manual",
        manualSkillLevel: args.skillTier,
        email: p2Email,
        phone: p2Phone,
        optIn: args.player2.optIn,
        createdAt: Date.now(),
      });
    }

    if (p1Id === p2Id) {
      return { success: false, error: "A tournament team must contain two different players." };
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
    const firstName = requiredName(args.firstName);
    if (!firstName) return { success: false, error: "First name is required." };
    const lastName = requiredName(args.lastName);
    if (!lastName) return { success: false, error: "Last name is required." };

    const email = normalizeEmail(args.email);
    const phone = normalizePhone(args.phone);
    const legacyEmail = legacyContactValue(args.email);
    const legacyPhone = legacyContactValue(args.phone);

    if (email) {
      const existing = await findPlayerByContact(ctx, args.tenantId, { email, legacyEmail });
      if (existing) {
        return { success: false, error: "A player with that email already exists in this workspace." };
      }
    }

    if (phone) {
      const existing = await findPlayerByContact(ctx, args.tenantId, { phone, legacyPhone });
      if (existing) {
        return { success: false, error: "A player with that phone number already exists in this workspace." };
      }
    }

    const playerId = await ctx.db.insert("players", {
      tenantId: args.tenantId,
      firstName,
      lastName,
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

    const patch: Partial<Doc<"players">> = {};

    if (args.firstName !== undefined) {
      const firstName = requiredName(args.firstName);
      if (!firstName) return { success: false, error: "First name is required." };
      patch.firstName = firstName;
    }
    if (args.lastName !== undefined) {
      const lastName = requiredName(args.lastName);
      if (!lastName) return { success: false, error: "Last name is required." };
      patch.lastName = lastName;
    }
    if (args.skillSource !== undefined) patch.skillSource = args.skillSource;
    if (args.manualSkillLevel !== undefined) patch.manualSkillLevel = args.manualSkillLevel;
    if (args.duprRating !== undefined) patch.duprRating = args.duprRating;
    if (args.username !== undefined) patch.username = args.username.trim() || undefined;
    if (args.gender !== undefined) patch.gender = args.gender;
    if (args.avatarUrl !== undefined) patch.avatarUrl = args.avatarUrl;
    if (args.notes !== undefined) patch.notes = args.notes;
    if (args.optIn !== undefined) patch.optIn = args.optIn;

    if (args.email !== undefined) {
      const email = normalizeEmail(args.email);
      if (email) {
        const existing = await findPlayerByContact(
          ctx,
          player.tenantId,
          { email, legacyEmail: legacyContactValue(args.email) },
          args.playerId
        );
        if (existing) {
          return { success: false, error: "A player with that email already exists in this workspace." };
        }
      }
      patch.email = email;
    }

    if (args.phone !== undefined) {
      const phone = normalizePhone(args.phone);
      if (phone) {
        const existing = await findPlayerByContact(
          ctx,
          player.tenantId,
          { phone, legacyPhone: legacyContactValue(args.phone) },
          args.playerId
        );
        if (existing) {
          return { success: false, error: "A player with that phone number already exists in this workspace." };
        }
      }
      patch.phone = phone;
    }

    await ctx.db.patch(args.playerId, patch);
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
  args: {
    playerId: v.id("players"),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const windowDays = Math.min(Math.max(Math.trunc(args.windowDays ?? 30), 1), 365);
    const windowStart = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const snapshots = await ctx.db
      .query("statsSnapshots")
      .withIndex("by_playerId_and_snapshotDate", (q) =>
        q.eq("playerId", args.playerId).gte("snapshotDate", windowStart)
      )
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
