import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

/**
 * Resolves a Game Master's workspace (tenant) by its ID.
 * Returns null if the provided ID is not a valid Convex ID.
 */
export const getById = query({
  args: { tenantId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("tenants", args.tenantId);
    if (!id) {
      return null;
    }
    return await ctx.db.get(id);
  },
});

/**
 * Seeds a default tenant/workspace in the database.
 * Used for local development and sandbox setups. Registered as an internal mutation.
 */
export const seed = internalMutation({
  args: {
    name: v.string(),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    contactEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tenants")
      .withIndex("by_contactEmail", (q) => q.eq("contactEmail", args.contactEmail))
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("tenants", {
      name: args.name,
      primaryColor: args.primaryColor ?? "#ff007f", // Sleek pink-accent default
      secondaryColor: args.secondaryColor ?? "#000000",
      contactEmail: args.contactEmail,
      createdAt: Date.now(),
    });
  },
});
