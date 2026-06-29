/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const workspaceInput = {
  name: "Test Pickleball Club",
  contactEmail: "GM@TestClub.com",
  logoUrl: "https://example.com/logo.png",
  primaryColor: "#ff007f",
  secondaryColor: "#000000",
};

function asIdentity(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  options: { role?: "owner" | "game_master" | "player"; orgId?: string } = {}
) {
  // The authz requireOwner helper requires a WorkOS-shaped identity
  // (issuer = https://api.workos.com, organization_id, role claim).
  // Tests use this shape so the WorkOS claim validation passes.
  const subjectTag = tokenIdentifier.replace(/[^a-zA-Z0-9]/g, "_");
  return t.withIdentity({
    tokenIdentifier,
    subject: subjectTag,
    issuer: "https://api.workos.com",
    name: "Game Master",
    email: "gm@testclub.com",
    organization_id: options.orgId ?? `org_${subjectTag}`,
    organization_membership_id: `wosm_${subjectTag}`,
    role: options.role ?? "owner",
  });
}

/**
 * Phase 2.4: there is no public `tenants.createWorkspace` mutation. Test
 * setup uses the internal `bootstrapFixedTenant` mutation, which is the
 * only path that may create a tenant row in the MVP. Each test gets its
 * own org id so duplicate-slug detection stays unambiguous.
 */
async function bootstrapWorkspaceFor(
  t: ReturnType<typeof convexTest>,
  options: {
    tokenIdentifier: string;
    slug?: string;
    name?: string;
    contactEmail?: string;
    workosOrganizationId?: string;
    role?: "owner" | "game_master" | "player";
    workosOrganizationMembershipId?: string;
  }
): Promise<Id<"tenants">> {
  const slug = options.slug ?? "test-club";
  const orgId =
    options.workosOrganizationId ?? `org_${options.tokenIdentifier.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const result = await t.mutation(internal.tenants.bootstrapFixedTenant, {
    slug,
    name: options.name ?? workspaceInput.name,
    contactEmail: options.contactEmail ?? workspaceInput.contactEmail,
    timezone: "Asia/Manila",
    workosOrganizationId: orgId,
  });
  // Project the user row AND an owner membership so
  // `getCurrentWorkspace`/`updateWorkspace` have something to operate
  // on. The WorkOS claim validation in `requireOwner` is bypassed in
  // tests via the `asIdentity` helper (no JWT is actually decoded).
  await t.run(async (ctx) => {
    const tenantId = result.tenantId;
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: options.tokenIdentifier,
      workosUserId: `wos_${options.tokenIdentifier}`,
      email: "gm@testclub.com",
      emailNormalized: "gm@testclub.com",
      fullName: "Game Master",
      tenantId,
      createdAt: now,
      lastSeenAt: now,
    });
    await ctx.db.insert("tenantMemberships", {
      tenantId,
      userId,
      role: options.role ?? "owner",
      status: "active",
      workosOrganizationMembershipId:
        options.workosOrganizationMembershipId ??
        `wosm_${options.tokenIdentifier.replace(/[^a-zA-Z0-9]/g, "_")}`,
      createdAt: now,
      updatedAt: now,
    });
  });
  return result.tenantId;
}

describe("Tenants", () => {
  describe("getCurrentWorkspace", () => {
    test("returns null without an authenticated identity", async () => {
      const t = convexTest(schema, modules);

      const currentWorkspace = await t.query(api.tenants.getCurrentWorkspace, {});

      expect(currentWorkspace).toBeNull();
    });

    test("returns null when the authenticated identity has no user mapping", async () => {
      const t = convexTest(schema, modules);
      const authed = asIdentity(t, "https://example.com|orphan-001");

      const currentWorkspace = await authed.query(api.tenants.getCurrentWorkspace, {});

      expect(currentWorkspace).toBeNull();
    });

    test("returns the authenticated user's workspace", async () => {
      const t = convexTest(schema, modules);
      const token = "https://example.com|owner-current-001";
      const authed = asIdentity(t, token);
      const tenantId = await bootstrapWorkspaceFor(t, { tokenIdentifier: token });

      const currentWorkspace = await authed.query(api.tenants.getCurrentWorkspace, {});

      expect(currentWorkspace?.tenant._id).toBe(tenantId);
      expect(currentWorkspace?.tenant.name).toBe("Test Pickleball Club");
      expect(currentWorkspace?.tenant.contactEmail).toBe("GM@TestClub.com");
      expect(currentWorkspace?.user.tenantId).toBe(tenantId);
      expect(currentWorkspace?.user.fullName).toBe("Game Master");
      expect(currentWorkspace?.user.emailNormalized).toBe("gm@testclub.com");
    });
  });

  describe("createWorkspace is no longer a public mutation", () => {
    test("public createWorkspace is not exported", () => {
      // Phase 2.4 — self-service tenant creation is removed. Bootstrap
      // must be internal-only. This guard test fails fast if anyone
      // re-introduces the public mutation.
      const exported = Object.keys(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("./_generated/api").api.tenants
      );
      expect(exported).not.toContain("createWorkspace");
    });
  });

  describe("updateWorkspace", () => {
    test("requires an authenticated identity", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await bootstrapWorkspaceFor(t, {
        tokenIdentifier: "https://api.workos.com|owner-003",
      });

      const result = await t.mutation(api.tenants.updateWorkspace, {
        tenantId,
        ...workspaceInput,
        name: "Updated Club",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/FORBIDDEN|denied|UNAUTHENTICATED/i);
    });

    test("updates the workspace when called by the owner", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-004";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapWorkspaceFor(t, { tokenIdentifier: token, role: "owner" });

      const result = await authed.mutation(api.tenants.updateWorkspace, {
        tenantId,
        name: "Updated Club",
        contactEmail: "owner@updatedclub.com",
        logoUrl: "",
        primaryColor: "#112233",
        secondaryColor: "#445566",
      });

      expect(result.success).toBe(true);
      const tenant = await t.run(async (ctx) => ctx.db.get(tenantId));
      expect(tenant?.name).toBe("Updated Club");
      expect(tenant?.contactEmail).toBe("owner@updatedclub.com");
      expect(tenant?.logoUrl).toBeUndefined();
      expect(tenant?.primaryColor).toBe("#112233");
      expect(tenant?.secondaryColor).toBe("#445566");
    });

    test("rejects updates from a Game Master with FORBIDDEN", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|gm-update";
      const authed = asIdentity(t, token, { role: "game_master" });
      const tenantId = await bootstrapWorkspaceFor(t, {
        tokenIdentifier: token,
        role: "game_master",
      });

      const result = await authed.mutation(api.tenants.updateWorkspace, {
        tenantId,
        ...workspaceInput,
        name: "Unauthorized Update",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/FORBIDDEN/);
      const tenant = await t.run(async (ctx) => ctx.db.get(tenantId));
      expect(tenant?.name).not.toBe("Unauthorized Update");
    });

    test("rejects updates from a player with FORBIDDEN", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|player-update";
      const authed = asIdentity(t, token, { role: "player" });
      const tenantId = await bootstrapWorkspaceFor(t, {
        tokenIdentifier: token,
        role: "player",
      });

      const result = await authed.mutation(api.tenants.updateWorkspace, {
        tenantId,
        ...workspaceInput,
        name: "Unauthorized Update",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/FORBIDDEN/);
      const tenant = await t.run(async (ctx) => ctx.db.get(tenantId));
      expect(tenant?.name).not.toBe("Unauthorized Update");
    });

    test("rejects updates from a user mapped to a different workspace", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await bootstrapWorkspaceFor(t, {
        tokenIdentifier: "https://api.workos.com|owner-005",
        slug: "club-a",
      });
      const otherTenantId = await bootstrapWorkspaceFor(t, {
        tokenIdentifier: "https://api.workos.com|owner-006",
        slug: "club-b",
        name: "Other Club",
      });
      expect(otherTenantId).not.toBe(tenantId);

      const otherUser = asIdentity(t, "https://api.workos.com|owner-006", { role: "owner" });
      const result = await otherUser.mutation(api.tenants.updateWorkspace, {
        tenantId,
        ...workspaceInput,
        name: "Unauthorized Update",
      });

      expect(result.success).toBe(false);
      // Cross-tenant access fails closed with FORBIDDEN because the
      // user does not have an active membership in `tenantId`.
      expect((result as any).error).toMatch(/FORBIDDEN|denied/i);
    });

    test("rejects malformed contact email", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-007";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapWorkspaceFor(t, { tokenIdentifier: token, role: "owner" });

      const result = await authed.mutation(api.tenants.updateWorkspace, {
        tenantId,
        ...workspaceInput,
        contactEmail: "owner@",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/valid contact email/i);
    });
  });

  // -------------------------------------------------------------------------
  // Task 1.4: fixed-tenant bootstrap + safe slug resolution
  // -------------------------------------------------------------------------

  describe("getPublicBySlug", () => {
    test("returns branding fields and never leaks private config", async () => {
      const t = convexTest(schema, modules);
      await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "pickle-point",
        name: "Pickle Point",
        contactEmail: "hello@picklepoint.example",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_pickle_point",
      });
      const view = await t.query(api.tenants.getPublicBySlug, { slug: "pickle-point" });
      expect(view).toMatchObject({
        slug: "pickle-point",
        name: "Pickle Point",
        timezone: "Asia/Manila",
        contactEmail: "hello@picklepoint.example",
      });
      // Public projection must NOT leak internal workosOrganizationId or status.
      expect((view as any).workosOrganizationId).toBeUndefined();
      expect((view as any).status).toBeUndefined();
    });

    test("returns null for unknown slug", async () => {
      const t = convexTest(schema, modules);
      const view = await t.query(api.tenants.getPublicBySlug, { slug: "no-such-tenant" });
      expect(view).toBeNull();
    });

    test("returns null for disabled tenants", async () => {
      const t = convexTest(schema, modules);
      await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "disabled-club",
        name: "Disabled Club",
        contactEmail: "x@disabled.example",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_disabled",
      });
      // Disable the tenant by direct update.
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("tenants")
          .withIndex("by_slug", (q) => q.eq("slug", "disabled-club"))
          .first();
        if (row) await ctx.db.patch(row._id, { status: "disabled" });
      });
      const view = await t.query(api.tenants.getPublicBySlug, { slug: "disabled-club" });
      expect(view).toBeNull();
    });
  });

  describe("bootstrapFixedTenant", () => {
    test("creates the fixed tenant with the requested configuration", async () => {
      const t = convexTest(schema, modules);
      const result = await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "fixed-1",
        name: "Fixed 1",
        contactEmail: "admin@fixed1.example",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_fixed_1",
      });
      expect(result.created).toBe(true);
      expect(result.tenantId).toBeDefined();
      const tenant = await t.run(async (ctx) => ctx.db.get(result.tenantId));
      expect(tenant).toMatchObject({
        slug: "fixed-1",
        workosOrganizationId: "org_fixed_1",
        status: "active",
        timezone: "Asia/Manila",
      });
    });

    test("re-running bootstrap is idempotent and never duplicates tenants", async () => {
      const t = convexTest(schema, modules);
      const first = await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "fixed-2",
        name: "Fixed 2",
        contactEmail: "admin@fixed2.example",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_fixed_2",
      });
      const second = await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "fixed-2",
        name: "Fixed 2 (rename attempt)",
        contactEmail: "admin@fixed2.example",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_fixed_2",
      });

      expect(second.tenantId).toBe(first.tenantId);
      expect(second.created).toBe(false);

      const tenants = await t.run(async (ctx) => ctx.db.query("tenants").collect());
      expect(tenants).toHaveLength(1);
      // The original name is preserved on re-bootstrap.
      expect(tenants[0].name).toBe("Fixed 2");
    });

    test("rejects mismatched re-point with a different workosOrganizationId", async () => {
      const t = convexTest(schema, modules);
      await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "fixed-3",
        name: "Fixed 3",
        contactEmail: "admin@fixed3.example",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_fixed_3",
      });

      await expect(
        t.mutation(internal.tenants.bootstrapFixedTenant, {
          slug: "fixed-3",
          name: "Different",
          contactEmail: "admin@fixed4.example",
          timezone: "Asia/Manila",
          workosOrganizationId: "org_fixed_4",
        })
      ).rejects.toThrow(/TENANT_MISMATCH/);
    });

    test("canonical production tenant selected explicitly, never first-row order", async () => {
      const t = convexTest(schema, modules);
      // Insert noncanonical tenant first.
      await t.run(async (ctx) =>
        ctx.db.insert("tenants", {
          name: "Pre-existing",
          slug: "pre-existing",
          timezone: "Asia/Manila",
          workosOrganizationId: "org_pre",
          status: "active",
          contactEmail: "pre@example.com",
          createdAt: Date.now(),
        })
      );
      const result = await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "canonical",
        name: "Canonical",
        contactEmail: "admin@canonical.example",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_canonical",
      });
      const canonical = await t.run(async (ctx) => ctx.db.get(result.tenantId));
      expect(canonical?.slug).toBe("canonical");
    });
  });

  // -------------------------------------------------------------------------
  // Task 2.4: internal lookup helpers used by the callback reconciliation
  // -------------------------------------------------------------------------

  describe("internal tenant lookups", () => {
    test("findByOrgId returns the canonical tenant for the canonical org id", async () => {
      const t = convexTest(schema, modules);
      await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "internal-org",
        name: "Internal Org",
        contactEmail: "io@example.com",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_internal_lookup",
      });
      const found = await t.query(internal.tenants.findByOrgId, {
        workosOrganizationId: "org_internal_lookup",
      });
      expect(found?.slug).toBe("internal-org");
    });

    test("findBySlug returns the canonical tenant for the canonical slug", async () => {
      const t = convexTest(schema, modules);
      await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "internal-slug",
        name: "Internal Slug",
        contactEmail: "is@example.com",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_internal_slug",
      });
      const found = await t.query(internal.tenants.findBySlug, {
        slug: "internal-slug",
      });
      expect(found?.workosOrganizationId).toBe("org_internal_slug");
    });

    test("findByOrgId returns null when the organization is not provisioned", async () => {
      const t = convexTest(schema, modules);
      const found = await t.query(internal.tenants.findByOrgId, {
        workosOrganizationId: "org_unknown",
      });
      expect(found).toBeNull();
    });
  });
});