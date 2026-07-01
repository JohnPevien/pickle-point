import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwner, AppError } from "./lib/authz";

type WorkspaceInput = {
  name: string;
  contactEmail: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
};

/**
 * Safe public projection of a tenant. This is the only shape unauthenticated
 * callers (`getById`) and the slug-based public home (`getPublicBySlug`) may
 * observe. It omits private config — `workosOrganizationId`, `status`, and
 * the workspace contact email — so the public surface never exposes contact
 * details, WorkOS identifiers, or other private fields.
 */
type PublicTenantProjection = {
  _id: Id<"tenants">;
  slug: string;
  name: string;
  timezone: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
};

/**
 * Project a tenant row into its public shape. Returns `null` when the row
 * is not publicly resolvable: a disabled tenant (`status !== "active"`) or a
 * legacy row missing the Phase 1.4 `slug`/`timezone` fields. The contact
 * email and WorkOS identifiers are never part of the public projection.
 */
function toPublicTenant(tenant: Doc<"tenants">): PublicTenantProjection | null {
  if (tenant.status !== "active") {
    return null;
  }
  if (!tenant.slug || !tenant.timezone) {
    return null;
  }
  return {
    _id: tenant._id,
    slug: tenant.slug,
    name: tenant.name,
    timezone: tenant.timezone,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
  };
}

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

/**
 * Public workspace projection by tenant id. Powers the public `[tenant]`
 * layout, registration page, and public tournament/open-play pages, so it
 * must remain callable without authentication (`public_read`).
 *
 * Returns only the safe public projection — never `workosOrganizationId`,
 * `status`, or `contactEmail`. Disabled tenants and un-bootstrapped rows
 * (missing `slug`/`timezone`) resolve to `null`, matching `getPublicBySlug`.
 */
export const getById = query({
  args: { tenantId: v.string() },
  handler: async (ctx, args): Promise<PublicTenantProjection | null> => {
    const id = ctx.db.normalizeId("tenants", args.tenantId);
    if (!id) {
      return null;
    }
    const tenant = await ctx.db.get(id);
    if (!tenant) {
      return null;
    }
    return toPublicTenant(tenant);
  },
});

/**
 * Owner-only workspace lookup for the authenticated caller. Powers the
 * workspace-settings page, which edits owner-only fields (contact email,
 * branding), so it is gated on `requireOwner`: only an active owner gets the
 * full `{ user, tenant }` docs. Game masters, players, suspended owners,
 * and cross-tenant callers resolve to `null`, and the calling page renders
 * "not found".
 *
 * Only `AppError` (the authorization vocabulary) is converted to `null`;
 * any other failure (e.g. a backend error) propagates so it is not silently
 * masked as a missing workspace.
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

    try {
      await requireOwner(ctx, user.tenantId);
    } catch (error) {
      // Authorization failures (UNAUTHENTICATED / FORBIDDEN /
      // MEMBERSHIP_SUSPENDED / RESOURCE_NOT_FOUND) map to "no workspace".
      // Unexpected errors must surface rather than be hidden as null.
      if (error instanceof AppError) {
        return null;
      }
      throw error;
    }

    const tenant = await ctx.db.get(user.tenantId);
    if (!tenant) {
      return null;
    }

    return { user, tenant };
  },
});

/**
 * Phase 2.4 — public workspace creation has been removed.
 *
 * The MVP topology is one fixed tenant seeded by an internal bootstrap
 * (`bootstrapFixedTenant`) and never created from the browser. The
 * tenant-creation surface previously exposed here is replaced by:
 *   - the internal `bootstrapFixedTenant` mutation for operators;
 *   - the canonical `WORKOS_ORGANIZATION_ID` env-driven lookup at
 *     callback time (`convex/callback.ts`).
 *
 * No public mutation may create a tenant. No UI surface may invite
 * itself into the workspace. This invariant protects the multi-tenant
 * upgrade path.
 */

/**
 * Updates workspace branding and contact fields for the authenticated workspace owner.
 */
export const updateWorkspace = mutation({
  args: {
    tenantId: v.id("tenants"),
    ...workspaceFieldsValidator,
  },
  handler: async (ctx, args) => {
    // Owner-only. requireOwner validates the identity, the local
    // active membership, AND the trusted WorkOS JWT claims. A player
    // or unauthenticated user attempting to update branding now fails
    // closed with FORBIDDEN before any DB write.
    try {
      await requireOwner(ctx, args.tenantId);
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : "Workspace access denied.";
      return { success: false, error: message };
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
 * Safe public projection of a tenant by slug. Used by the public workspace
 * home (`/{workspaceSlug}`) before login. Internal fields such as
 * `workosOrganizationId`, `status`, and any future admin-only configuration
 * are intentionally omitted. Shares the projection with `getById`.
 */
export const getPublicBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<PublicTenantProjection | null> => {
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!tenant || tenant.status !== "active") {
      return null;
    }
    // `toPublicTenant` returns null for rows missing the Phase 1.4 slug +
    // timezone fields, hiding legacy rows from the public projection
    // until backfilled.
    return toPublicTenant(tenant);
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
export const findByOrgId = internalQuery({
  args: { workosOrganizationId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("tenants")
      .withIndex("by_workosOrganizationId", (q) =>
        q.eq("workosOrganizationId", args.workosOrganizationId)
      )
      .first();
    return row ?? null;
  },
});

export const findBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    return row ?? null;
  },
});

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
