import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Resolves a Game Master's workspace (tenant) by its ID.
 * In sandbox mode, if the provided ID is not a valid Convex ID, 
 * it falls back to the first available tenant in the database to prevent crashing.
 */
export const getById = query({
  args: { tenantId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("tenants", args.tenantId);
    if (!id) {
      // Sandbox fallback: return the first tenant if one exists in the database
      const firstTenant = await ctx.db.query("tenants").first();
      return firstTenant || null;
    }
    return await ctx.db.get(id);
  },
});

/**
 * Seeds a default tenant/workspace in the database.
 * Used for local development and sandbox setups.
 */
export const seed = mutation({
  args: {
    name: v.string(),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    contactEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tenants")
      .filter((q) => q.eq(q.field("contactEmail"), args.contactEmail))
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
