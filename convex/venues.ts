import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireRole, AppError } from "./lib/authz";

const DEFAULT_VENUE_LIST_LIMIT = 100;
const MAX_VENUE_LIST_LIMIT = 200;

/** Roles permitted to manage venues. Task 3.1: owner + game_master. */
const VENUE_ROLES = ["owner", "game_master"] as const;

function requiredName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function optionalAddress(value: string | undefined) {
  return value?.trim() || undefined;
}

function validCourtCount(value: number) {
  if (!Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Task 3.1: lists venues for a tenant workspace. Caller must be an owner or
 * game_master in `args.tenantId`. Authority is checked server-side via
 * `requireRole`, which validates the identity, the local active membership,
 * and the trusted WorkOS claims for admin roles. Any failure throws an
 * `AppError` (UNAUTHENTICATED / FORBIDDEN / MEMBERSHIP_SUSPENDED).
 */
export const listByTenant = query({
  args: {
    tenantId: v.id("tenants"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.tenantId, VENUE_ROLES);

    const limit = clampInt(args.limit ?? DEFAULT_VENUE_LIST_LIMIT, 1, MAX_VENUE_LIST_LIMIT);
    return await ctx.db
      .query("venues")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Task 3.1: creates a venue with a required name and positive court count.
 * Caller must be an owner or game_master in `args.tenantId`. Authority is
 * checked before any write. Auth failures return `{ success:false, error }`
 * (consistent with the other venue mutations) so the admin UI can surface a
 * toast; business-validation failures keep the same shape.
 */
export const createVenue = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    courtCount: v.number(),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      await requireRole(ctx, args.tenantId, VENUE_ROLES);
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : "Venue access denied.";
      return { success: false, error: message };
    }

    const name = requiredName(args.name);
    if (!name) {
      return { success: false, error: "Venue name is required." };
    }

    const courtCount = validCourtCount(args.courtCount);
    if (courtCount === null) {
      return { success: false, error: "Court count must be a positive whole number." };
    }

    const venueId = await ctx.db.insert("venues", {
      tenantId: args.tenantId,
      name,
      courtCount,
      address: optionalAddress(args.address),
      createdAt: Date.now(),
    });

    return { success: true, venueId };
  },
});

/**
 * Task 3.1: updates editable venue fields. Authority is derived from the
 * loaded venue row (`venue.tenantId`), never from the client-supplied
 * `args.tenantId` — so a caller cannot act on a venue in a tenant they have
 * no membership in by passing a foreign tenant id. After authorization, the
 * client `tenantId` is still compared against the derived tenant to surface
 * a clear "workspace mismatch" error for stale clients.
 */
export const updateVenue = mutation({
  args: {
    tenantId: v.id("tenants"),
    venueId: v.id("venues"),
    name: v.optional(v.string()),
    courtCount: v.optional(v.number()),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const venue = await ctx.db.get(args.venueId);
    if (!venue) {
      return { success: false, error: "Venue not found." };
    }

    try {
      // Authority is derived from the resource, not the client tenantId.
      await requireRole(ctx, venue.tenantId, VENUE_ROLES);
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : "Venue access denied.";
      return { success: false, error: message };
    }

    // Surface a stale-client mismatch as a clear business error after the
    // authorization check has passed.
    if (venue.tenantId !== args.tenantId) {
      return { success: false, error: "Venue workspace mismatch." };
    }

    const patch: Partial<Doc<"venues">> = {};
    if (args.name !== undefined) {
      const name = requiredName(args.name);
      if (!name) {
        return { success: false, error: "Venue name is required." };
      }
      patch.name = name;
    }
    if (args.courtCount !== undefined) {
      const courtCount = validCourtCount(args.courtCount);
      if (courtCount === null) {
        return { success: false, error: "Court count must be a positive whole number." };
      }
      patch.courtCount = courtCount;
    }
    if (args.address !== undefined) {
      patch.address = optionalAddress(args.address);
    }

    await ctx.db.patch(args.venueId, patch);
    return { success: true };
  },
});

/**
 * Task 3.1: deletes a venue. Authority is derived from the venue row's
 * tenant, then the client `tenantId` is checked for a stale-client
 * mismatch. Deletion is refused when an open play session still references
 * the venue.
 */
export const deleteVenue = mutation({
  args: {
    tenantId: v.id("tenants"),
    venueId: v.id("venues"),
  },
  handler: async (ctx, args) => {
    const venue = await ctx.db.get(args.venueId);
    if (!venue) {
      return { success: false, error: "Venue not found." };
    }

    try {
      await requireRole(ctx, venue.tenantId, VENUE_ROLES);
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : "Venue access denied.";
      return { success: false, error: message };
    }

    if (venue.tenantId !== args.tenantId) {
      return { success: false, error: "Venue workspace mismatch." };
    }

    const referencedSession = await ctx.db
      .query("openPlaySessions")
      .withIndex("by_venueId", (q) => q.eq("venueId", args.venueId))
      .first();
    if (referencedSession) {
      return { success: false, error: "Venue is used by an open play session." };
    }

    await ctx.db.delete(args.venueId);
    return { success: true };
  },
});
