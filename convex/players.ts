import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireRole,
  requireOwnPlayer,
  requirePlayerProfile,
  AppError,
} from "./lib/authz";
import { finiteInt } from "./lib/num";
import {
  findPlayerByContact,
  legacyContactValue,
  normalizeEmail,
  normalizePhone,
} from "./playerContact";

/** Roles permitted to manage players. Task 3.2: owner + game_master. */
const PLAYER_ADMIN_ROLES = ["owner", "game_master"] as const;

/**
 * Maximum `numItems` Convex accepts for one `paginate` call. The cap
 * is intentionally below Convex's hard internal limit so we leave
 * headroom for callers that may scale up later.
 */
const MAX_PLAYER_LIST_LIMIT = 200;

/**
 * Run an authorization helper and translate its `AppError` into the
 * `{success:false, error}` shape admin mutations return. Other errors
 * propagate. Use to avoid repeating the try/catch bridge in every
 * admin mutation.
 */
async function authOrFail<T>(
  auth: Promise<T>
): Promise<{ success: false; error: string } | { success: true; value: T }> {
  try {
    return { success: true, value: await auth };
  } catch (error) {
    if (error instanceof AppError) {
      return { success: false, error: error.message };
    }
    throw error;
  }
}

/**
 * Defensive cap on the number of snapshots read by `getPlayerStats`. The
 * query already constrains by a day window; this cap protects against a
 * pathological snapshot volume. When exceeded, the response carries
 * `truncated: true` so the caller knows the aggregate is over a subset.
 */
const MAX_PLAYER_STATS_SNAPSHOTS = 1000;

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

function optionalText(value: string | undefined) {
  return value?.trim() || undefined;
}

async function findPlayerDeleteBlocker(
  ctx: MutationCtx,
  player: Doc<"players">
) {
  const sessionPlayer = await ctx.db
    .query("sessionPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
    .first();
  if (sessionPlayer) {
    return "sessions";
  }

  const tournamentEntrantAsPlayer1 = await ctx.db
    .query("tournamentEntrants")
    .withIndex("by_player1Id", (q) => q.eq("player1Id", player._id))
    .first();
  if (tournamentEntrantAsPlayer1) {
    return "tournament entrants";
  }

  const tournamentEntrantAsPlayer2 = await ctx.db
    .query("tournamentEntrants")
    .withIndex("by_player2Id", (q) => q.eq("player2Id", player._id))
    .first();
  if (tournamentEntrantAsPlayer2) {
    return "tournament entrants";
  }

  // Bounded lookup via `by_tenant_and_playerId`. Reads a single index
  // page (`.first`) instead of streaming the whole tenant, so the
  // mutation never risks a Convex transaction limit. Pre-existing rows
  // that predate the reference table are still detected because the
  // mutation that records matches eagerly backfills the reference row.
  const matchParticipant = await ctx.db
    .query("matchHistoryParticipants")
    .withIndex("by_tenant_and_playerId", (q) =>
      q.eq("tenantId", player.tenantId).eq("playerId", player._id)
    )
    .first();
  if (matchParticipant) {
    return "match history";
  }

  const statsSnapshot = await ctx.db
    .query("statsSnapshots")
    .withIndex("by_player", (q) => q.eq("playerId", player._id))
    .first();
  if (statsSnapshot) {
    return "stats";
  }

  return null;
}

/**
 * Lists players within an owner/game_master's workspace. Task 3.2: caller
 * must be an owner or game_master in `args.tenantId` (validated server-side,
 * including trusted WorkOS claims for admin roles). Returns full player docs
 * — this is an administrative view, so contact fields are expected here; the
 * public boundary is enforced separately by `stats.getLeaderboard`.
 *
 * Phase 3.2 review fix: callers paginate via `paginationOpts` instead of
 * silently truncating at the cap. The response shape is Convex's standard
 * `{ page, isDone, continueCursor }` so the UI can walk every player with
 * a deterministic cursor and surface an explicit truncation indicator.
 */
export const listByTenant = query({
  args: {
    tenantId: v.id("tenants"),
    limit: v.optional(v.number()),
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.tenantId, PLAYER_ADMIN_ROLES);
    const numItems = finiteInt(
      args.limit ?? MAX_PLAYER_LIST_LIMIT,
      1,
      MAX_PLAYER_LIST_LIMIT,
      MAX_PLAYER_LIST_LIMIT
    );
    const opts = args.paginationOpts ?? { numItems, cursor: null };
    return await ctx.db
      .query("players")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("asc")
      .paginate(opts);
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
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      return { success: false, error: "Tournament not found." };
    }

    // Tournament enrollment is player-owned. Until Task 4.1 adds the
    // account-backed `players.userId` link, this fails closed with
    // PROFILE_REQUIRED. Crucially, no caller-provided contact data can create
    // a persistent player row anymore.
    const registeredPlayer = await requirePlayerProfile(ctx, tournament.tenantId);

    if (tournament.tenantId !== args.tenantId) {
      return { success: false, error: "Tournament workspace mismatch." };
    }
    if (tournament.status !== "registration_open") {
      return { success: false, error: "This tournament is not currently open for registration." };
    }

    const teamName = requiredName(args.teamName);
    if (!teamName) return { success: false, error: "Team name is required." };

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

    if (await isPlayerInTournament(registeredPlayer._id)) {
      return { success: false, error: "You are already registered for this tournament." };
    }

    // The legacy form still sends both player blocks. Player 1 is ignored as
    // an authority source: the authenticated account profile is always slot
    // one. Player 2 must already exist; this mutation never creates profiles.
    const p2Email = normalizeEmail(args.player2.email);
    const p2Phone = normalizePhone(args.player2.phone);
    const p2LegacyEmail = legacyContactValue(args.player2.email);
    const p2LegacyPhone = legacyContactValue(args.player2.phone);
    if (!p2Email && !p2Phone) {
      return { success: false, error: "Partner must have an email or phone number." };
    }

    const partner = await findPlayerByContact(ctx, tournament.tenantId, {
      email: p2Email,
      phone: p2Phone,
      legacyEmail: p2LegacyEmail,
      legacyPhone: p2LegacyPhone,
    });
    if (!partner) {
      return { success: false, error: "Partner must complete a registered player profile first." };
    }
    if (partner._id === registeredPlayer._id) {
      return { success: false, error: "A tournament team must contain two different players." };
    }
    if (await isPlayerInTournament(partner._id)) {
      return { success: false, error: "Partner is already registered for this tournament." };
    }

    const entrantId = await ctx.db.insert("tournamentEntrants", {
      tournamentId: args.tournamentId,
      name: teamName,
      player1Id: registeredPlayer._id,
      player2Id: partner._id,
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

/**
 * Fetches a single player by ID. Task 3.2: authority is derived from the
 * loaded player row (`player.tenantId`) via `requireOwnPlayer`, which admits
 * owner/game_master and rejects players (FORBIDDEN) and unauthenticated
 * callers. Until Task 4.1 wires `players.userId`, player self-service fails
 * closed — there is no way to prove ownership of a player row.
 *
 * A missing player throws RESOURCE_NOT_FOUND rather than returning null, so
 * no caller can distinguish "exists but forbidden" from "absent".
 */
export const getById = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => {
    const { player } = await requireOwnPlayer(ctx, args.playerId);
    return player;
  },
});

/**
 * Creates a player profile in a tenant workspace. Task 3.2: caller must be
 * an owner or game_master in `args.tenantId` (checked before any insert).
 * Authorization failures return `{success:false, error}` so the admin UI
 * can surface a toast; unexpected errors propagate.
 */
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
    const auth = await authOrFail(
      requireRole(ctx, args.tenantId, PLAYER_ADMIN_ROLES)
    );
    if (!auth.success) return { success: false, error: auth.error };

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
      username: optionalText(args.username),
      email,
      phone,
      gender: optionalText(args.gender),
      avatarUrl: optionalText(args.avatarUrl),
      notes: optionalText(args.notes),
      optIn: args.optIn,
      createdAt: Date.now(),
    });

    return { success: true, playerId };
  },
});

/**
 * Updates editable player profile fields. Task 3.2: authority is derived
 * from the loaded player row via `requireOwnPlayer` (admin-only; players
 * fail closed with FORBIDDEN until Task 4.1). The client `tenantId` is kept
 * only to surface a stale-client mismatch after authorization. Only
 * `AppError` is converted to `{success:false, error}`; unexpected errors
 * propagate. The patch only ever sets editable profile fields — `tenantId`,
 * `_id`, and `createdAt` are never modified.
 */
export const updatePlayer = mutation({
  args: {
    tenantId: v.id("tenants"),
    playerId: v.id("players"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    skillSource: v.optional(v.union(v.literal("manual"), v.literal("dupr"))),
    manualSkillLevel: v.optional(skillLevelValidator),
    duprRating: v.optional(v.union(v.float64(), v.null())),
    username: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    gender: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    optIn: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await authOrFail(requireOwnPlayer(ctx, args.playerId));
    if (!auth.success) return { success: false, error: auth.error };
    const player: Doc<"players"> = auth.value.player;
    // Stale-client guard: the client tenantId must match the derived tenant.
    if (player.tenantId !== args.tenantId) {
      return { success: false as const, error: "Player workspace mismatch." };
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
    if (args.duprRating !== undefined) patch.duprRating = args.duprRating ?? undefined;
    if (args.username !== undefined) patch.username = optionalText(args.username);
    if (args.gender !== undefined) patch.gender = optionalText(args.gender);
    if (args.avatarUrl !== undefined) patch.avatarUrl = optionalText(args.avatarUrl);
    if (args.notes !== undefined) patch.notes = optionalText(args.notes);
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

/**
 * Deletes a player only when no sessions, tournament entries, match history,
 * or stats still reference them. Task 3.2: authority is derived from the
 * loaded player row via `requireOwnPlayer` (admin-only). Only `AppError` is
 * converted to `{success:false, error}`; unexpected errors propagate.
 */
export const deletePlayer = mutation({
  args: { tenantId: v.id("tenants"), playerId: v.id("players") },
  handler: async (ctx, args) => {
    const auth = await authOrFail(requireOwnPlayer(ctx, args.playerId));
    if (!auth.success) return { success: false, error: auth.error };
    const player: Doc<"players"> = auth.value.player;
    if (player.tenantId !== args.tenantId) {
      return { success: false as const, error: "Player workspace mismatch." };
    }
    const blocker = await findPlayerDeleteBlocker(ctx, player);
    if (blocker) {
      return { success: false as const, error: `Cannot delete player with existing ${blocker}.` };
    }
    await ctx.db.delete(args.playerId);
    return { success: true as const };
  },
});

/**
 * Aggregates a player's recent stats snapshots over a bounded day window.
 * Task 3.2: authority is derived from the loaded player row via
 * `requireOwnPlayer` (admin-only; players fail closed with FORBIDDEN until
 * Task 4.1). Returns only aggregate counters — no contact/private fields.
 *
 * Reads are capped at `MAX_PLAYER_STATS_SNAPSHOTS` (ordered newest-first by
 * snapshotDate). If the cap is exceeded, `truncated: true` signals that the
 * aggregate covers a subset of the window.
 */
export const getPlayerStats = query({
  args: {
    playerId: v.id("players"),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    wins: number;
    losses: number;
    pointsFor: number;
    pointsAgainst: number;
    truncated: boolean;
  }> => {
    await requireOwnPlayer(ctx, args.playerId);

    const windowDays = finiteInt(args.windowDays ?? 30, 1, 365, 30);
    const windowStart = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    // Fetch MAX + 1 so we can detect truncation without an extra count.
    const snapshots = await ctx.db
      .query("statsSnapshots")
      .withIndex("by_playerId_and_snapshotDate", (q) =>
        q.eq("playerId", args.playerId).gte("snapshotDate", windowStart)
      )
      .order("desc")
      .take(MAX_PLAYER_STATS_SNAPSHOTS + 1);

    const truncated = snapshots.length > MAX_PLAYER_STATS_SNAPSHOTS;
    const considered = truncated ? snapshots.slice(0, MAX_PLAYER_STATS_SNAPSHOTS) : snapshots;

    const totals = considered.reduce(
      (acc, s) => ({
        wins: acc.wins + s.wins,
        losses: acc.losses + s.losses,
        pointsFor: acc.pointsFor + s.pointsFor,
        pointsAgainst: acc.pointsAgainst + s.pointsAgainst,
      }),
      { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }
    );
    return { ...totals, truncated };
  },
});
