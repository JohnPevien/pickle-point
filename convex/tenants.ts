import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

type WorkspaceInput = {
  name: string;
  contactEmail: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
};

const workspaceFieldsValidator = {
  name: v.string(),
  contactEmail: v.string(),
  logoUrl: v.optional(v.string()),
  primaryColor: v.optional(v.string()),
  secondaryColor: v.optional(v.string()),
};

function requiredString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeContactEmail(value: string) {
  const email = requiredString(value)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function normalizeHexColor(value: string | undefined) {
  const color = optionalString(value);
  if (!color) {
    return undefined;
  }
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function normalizeWorkspaceInput(input: WorkspaceInput) {
  const name = requiredString(input.name);
  if (!name) {
    return { success: false as const, error: "Workspace name is required." };
  }

  const contactEmail = normalizeContactEmail(input.contactEmail);
  if (!contactEmail) {
    return { success: false as const, error: "A valid contact email is required." };
  }

  const primaryColor = normalizeHexColor(input.primaryColor);
  if (primaryColor === null) {
    return { success: false as const, error: "Primary color must be a 6-digit hex color." };
  }

  const secondaryColor = normalizeHexColor(input.secondaryColor);
  if (secondaryColor === null) {
    return { success: false as const, error: "Secondary color must be a 6-digit hex color." };
  }

  return {
    success: true as const,
    workspace: {
      name,
      contactEmail,
      logoUrl: optionalString(input.logoUrl),
      primaryColor,
      secondaryColor,
    },
  };
}

async function getUserByTokenIdentifier(ctx: QueryCtx | MutationCtx, tokenIdentifier: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier)
    )
    .first();
}

async function requireCurrentUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return { success: false as const, error: "Authentication required." };
  }

  const user = await getUserByTokenIdentifier(ctx, identity.tokenIdentifier);
  if (!user) {
    return { success: false as const, error: "Workspace owner not found." };
  }

  return { success: true as const, identity, user };
}

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
 * Gets the authenticated user's workspace and owner record.
 */
export const getCurrentWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await getUserByTokenIdentifier(ctx, identity.tokenIdentifier);
    if (!user) {
      return null;
    }

    const tenant = await ctx.db.get(user.tenantId);
    if (!tenant) {
      return null;
    }

    return { user, tenant };
  },
});

/**
 * Creates a tenant workspace for the authenticated user, or returns their existing workspace.
 */
export const createWorkspace = mutation({
  args: workspaceFieldsValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { success: false, error: "Authentication required." };
    }

    const normalized = normalizeWorkspaceInput(args);
    if (!normalized.success) {
      return { success: false, error: normalized.error };
    }

    const existingUser = await getUserByTokenIdentifier(ctx, identity.tokenIdentifier);
    if (existingUser) {
      const existingTenant = await ctx.db.get(existingUser.tenantId);
      if (existingTenant) {
        return {
          success: true,
          tenantId: existingUser.tenantId,
          created: false,
        };
      }
    }

    const tenantId = await ctx.db.insert("tenants", {
      ...normalized.workspace,
      createdAt: Date.now(),
    });

    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        tenantId,
        email: identity.email ?? normalized.workspace.contactEmail,
        name: identity.name,
      });
    } else {
      await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        tenantId,
        email: identity.email ?? normalized.workspace.contactEmail,
        name: identity.name,
        createdAt: Date.now(),
      });
    }

    return { success: true, tenantId, created: true };
  },
});

/**
 * Updates workspace branding and contact fields for the authenticated workspace owner.
 */
export const updateWorkspace = mutation({
  args: {
    tenantId: v.id("tenants"),
    ...workspaceFieldsValidator,
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    if (!currentUser.success) {
      return { success: false, error: currentUser.error };
    }

    if (currentUser.user.tenantId !== args.tenantId) {
      return { success: false, error: "Workspace access denied." };
    }

    const normalized = normalizeWorkspaceInput(args);
    if (!normalized.success) {
      return { success: false, error: normalized.error };
    }

    const patch: Pick<
      Doc<"tenants">,
      "name" | "contactEmail" | "logoUrl" | "primaryColor" | "secondaryColor"
    > = normalized.workspace;

    await ctx.db.patch(args.tenantId, patch);
    return { success: true };
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
