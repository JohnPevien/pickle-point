import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const DEFAULT_VENUE_LIST_LIMIT = 100;
const MAX_VENUE_LIST_LIMIT = 200;

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
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Lists venues for a tenant workspace.
 */
export const listByTenant = query({
  args: {
    tenantId: v.id("tenants"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      return [];
    }

    const limit = clampInt(args.limit ?? DEFAULT_VENUE_LIST_LIMIT, 1, MAX_VENUE_LIST_LIMIT);
    return await ctx.db
      .query("venues")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(limit);
  },
});

export const createVenue = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    courtCount: v.number(),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      return { success: false, error: "Tenant not found." };
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
