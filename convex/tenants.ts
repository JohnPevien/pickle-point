import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

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

/**
 * Convert a tenant display name into a URL-safe slug. Used during
 * Phase 1 widening to backfill `tenants.slug` for fixtures created
 * before the field was required. Phase 1.4 introduces the canonical
 * fixed-tenant slug; this helper is only a fallback for legacy rows.
 */
export function slugifyTenantName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "tenant";
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
      slug: slugifyTenantName(normalized.workspace.name),
      timezone: "Asia/Manila",
      workosOrganizationId: `local_${Date.now()}`,
      status: "active",
      createdAt: Date.now(),
    });

    const email = identity.email ?? normalized.workspace.contactEmail;
    const emailNormalized = email.trim().toLowerCase();
    // The WorkOS AuthKit subject claim is the canonical workosUserId.
    // Fall back to the token subject segment when unavailable.
    const workosUserId =
      identity.subject ?? identity.tokenIdentifier.split("|").pop() ?? identity.tokenIdentifier;

    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        tenantId,
        email,
        emailNormalized,
        workosUserId,
        fullName: identity.name ?? existingUser.fullName,
        lastSeenAt: Date.now(),
      });
    } else {
      const now = Date.now();
      await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        workosUserId,
        email,
        emailNormalized,
        fullName: identity.name,
        tenantId,
        createdAt: now,
        lastSeenAt: now,
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
      slug: slugifyTenantName(args.name),
      timezone: "Asia/Manila",
      workosOrganizationId: `local_seed_${Date.now()}`,
      status: "active",
      primaryColor: args.primaryColor ?? "#ff007f", // Sleek pink-accent default
      secondaryColor: args.secondaryColor ?? "#000000",
      contactEmail: args.contactEmail,
      createdAt: Date.now(),
    });
  },
});

// -------------------------------------------------------------------------
// Task 1.4: fixed-tenant bootstrap and safe slug resolution
// -------------------------------------------------------------------------

/**
 * Safe public projection of a tenant. Used by the public workspace
 * home (`/{workspaceSlug}`) before login. Internal fields such as
 * `workosOrganizationId`, `status`, and any future admin-only
 * configuration are intentionally omitted.
 */
export const getPublicBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<{
    _id: Id<"tenants">;
    slug: string;
    name: string;
    timezone: string;
    contactEmail: string;
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
  } | null> => {
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!tenant || tenant.status !== "active") {
      return null;
    }
    // A row is only publicly resolvable when it has been bootstrapped
    // with a slug + timezone. Legacy rows without those fields are
    // hidden from the public projection until backfilled.
    if (!tenant.slug || !tenant.timezone) {
      return null;
    }
    return {
      _id: tenant._id,
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      contactEmail: tenant.contactEmail,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
    };
  },
});

/**
 * Phase 1.4 bootstrap. Internally seeds the single fixed tenant row
 * for the MVP deployment. Re-running with the same slug + WorkOS
 * organization id is idempotent; mismatched identifiers are rejected
 * so a stale bootstrap can never silently repoint the canonical
 * tenant. Selection of the canonical tenant is explicit (by slug +
 * workosOrganizationId), never by arbitrary first-row order.
 */
export const bootstrapFixedTenant = internalMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    contactEmail: v.string(),
    timezone: v.string(),
    workosOrganizationId: v.string(),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ tenantId: Id<"tenants">; created: boolean }> => {
    // 1. Look up by slug first — that's the primary identifier callers
    //    see in URLs.
    const bySlug = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (bySlug) {
      if (bySlug.workosOrganizationId !== args.workosOrganizationId) {
        throw new Error("TENANT_MISMATCH: slug already bound to a different WorkOS organization");
      }
      return { tenantId: bySlug._id, created: false };
    }

    // 2. Defensive: slug not taken, but WorkOS org already linked?
    //    Reject so we never silently re-point.
    const byOrg = await ctx.db
      .query("tenants")
      .withIndex("by_workosOrganizationId", (q) =>
        q.eq("workosOrganizationId", args.workosOrganizationId)
      )
      .first();
    if (byOrg && byOrg.slug !== args.slug) {
      throw new Error("TENANT_MISMATCH: WorkOS organization already bound to a different slug");
    }

    // 3. Safe to create.
    const now = Date.now();
    const tenantId = await ctx.db.insert("tenants", {
      slug: args.slug,
      name: args.name,
      contactEmail: args.contactEmail,
      timezone: args.timezone,
      workosOrganizationId: args.workosOrganizationId,
      status: "active",
      primaryColor: args.primaryColor,
      secondaryColor: args.secondaryColor,
      logoUrl: args.logoUrl,
      createdAt: now,
    });

    await ctx.db.insert("auditLogs", {
      tenantId,
      action: "tenant.bootstrap",
      resourceType: "tenants",
      resourceId: tenantId,
      after: JSON.stringify({
        slug: args.slug,
        workosOrganizationId: args.workosOrganizationId,
        timezone: args.timezone,
      }),
      createdAt: now,
    });

    return { tenantId, created: true };
  },
});
