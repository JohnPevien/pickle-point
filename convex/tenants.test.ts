/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("Tenants", () => {
  const workspaceInput = {
    name: "Test Pickleball Club",
    contactEmail: "GM@TestClub.com",
    logoUrl: "https://example.com/logo.png",
    primaryColor: "#ff007f",
    secondaryColor: "#000000",
  };

  function asIdentity(t: ReturnType<typeof convexTest>, tokenIdentifier: string) {
    return t.withIdentity({
      tokenIdentifier,
      email: "gm@testclub.com",
      name: "Game Master",
    });
  }

  async function createWorkspaceFor(
    t: ReturnType<typeof convexTest>,
    tokenIdentifier: string,
    name = workspaceInput.name
  ) {
    const authed = asIdentity(t, tokenIdentifier);
    const result = await authed.mutation(api.tenants.createWorkspace, {
      ...workspaceInput,
      name,
    });
    return (result as { tenantId: Id<"tenants"> }).tenantId;
  }

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
      const authed = asIdentity(t, "https://example.com|owner-current-001");
      const tenantId = await createWorkspaceFor(t, "https://example.com|owner-current-001");

      const currentWorkspace = await authed.query(api.tenants.getCurrentWorkspace, {});

      expect(currentWorkspace?.tenant._id).toBe(tenantId);
      expect(currentWorkspace?.tenant.name).toBe("Test Pickleball Club");
      expect(currentWorkspace?.tenant.contactEmail).toBe("gm@testclub.com");
      expect(currentWorkspace?.user.tenantId).toBe(tenantId);
      expect(currentWorkspace?.user.fullName).toBe("Game Master");
      expect(currentWorkspace?.user.emailNormalized).toBe("gm@testclub.com");
    });
  });

  describe("createWorkspace", () => {
    test("requires an authenticated identity", async () => {
      const t = convexTest(schema, modules);

      const result = await t.mutation(api.tenants.createWorkspace, workspaceInput);

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/authentication required/i);
    });

    test("creates a tenant and user mapping from the current identity", async () => {
      const t = convexTest(schema, modules);
      const authed = asIdentity(t, "https://example.com|owner-001");

      const result = await authed.mutation(api.tenants.createWorkspace, workspaceInput);

      expect(result.success).toBe(true);
      const tenantId = (result as { tenantId: Id<"tenants"> }).tenantId;
      const tenant = await t.run(async (ctx) => ctx.db.get(tenantId));
      expect(tenant?.name).toBe("Test Pickleball Club");
      expect(tenant?.contactEmail).toBe("gm@testclub.com");

      const user = await t.run(async (ctx) => {
        return await ctx.db
          .query("users")
          .withIndex("by_tokenIdentifier", (q) =>
            q.eq("tokenIdentifier", "https://example.com|owner-001")
          )
          .first();
      });
      expect(user?.tenantId).toBe(tenantId);
      expect(user?.email).toBe("gm@testclub.com");
      expect(user?.emailNormalized).toBe("gm@testclub.com");
      expect(user?.fullName).toBe("Game Master");
      expect(user?.workosUserId).toBeTruthy();
    });

    test("returns the existing tenant for an already mapped identity", async () => {
      const t = convexTest(schema, modules);
      const authed = asIdentity(t, "https://example.com|owner-002");

      const first = await authed.mutation(api.tenants.createWorkspace, workspaceInput);
      const second = await authed.mutation(api.tenants.createWorkspace, {
        ...workspaceInput,
        name: "Different Club",
      });

      expect(second.success).toBe(true);
      expect((second as { tenantId: Id<"tenants"> }).tenantId).toBe(
        (first as { tenantId: Id<"tenants"> }).tenantId
      );
      expect((second as { created: boolean }).created).toBe(false);
    });

    test.each(["owner@", "@example.com", "owner example.com", "owner@example"])(
      "rejects malformed contact email %s",
      async (contactEmail) => {
        const t = convexTest(schema, modules);
        const authed = asIdentity(t, "https://example.com|owner-invalid-email");

        const result = await authed.mutation(api.tenants.createWorkspace, {
          ...workspaceInput,
          contactEmail,
        });

        expect(result.success).toBe(false);
        expect((result as any).error).toMatch(/valid contact email/i);
      }
    );
  });

  describe("updateWorkspace", () => {
    test("requires an authenticated identity", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await createWorkspaceFor(t, "https://example.com|owner-003");

      const result = await t.mutation(api.tenants.updateWorkspace, {
        tenantId,
        ...workspaceInput,
        name: "Updated Club",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/authentication required/i);
    });

    test("updates the current user's workspace", async () => {
      const t = convexTest(schema, modules);
      const authed = asIdentity(t, "https://example.com|owner-004");
      const tenantId = await createWorkspaceFor(t, "https://example.com|owner-004");

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

    test("rejects updates from a user mapped to a different workspace", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await createWorkspaceFor(t, "https://example.com|owner-005");
      const otherTenantId = await createWorkspaceFor(
        t,
        "https://example.com|owner-006",
        "Other Club"
      );
      expect(otherTenantId).not.toBe(tenantId);

      const otherUser = asIdentity(t, "https://example.com|owner-006");
      const result = await otherUser.mutation(api.tenants.updateWorkspace, {
        tenantId,
        ...workspaceInput,
        name: "Unauthorized Update",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/access denied/i);
    });

    test("rejects malformed contact email", async () => {
      const t = convexTest(schema, modules);
      const authed = asIdentity(t, "https://example.com|owner-007");
      const tenantId = await createWorkspaceFor(t, "https://example.com|owner-007");

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
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.tenantId).toBe(first.tenantId);
      // Row count check: exactly one tenant with that slug.
      const all = await t.run(async (ctx) =>
        ctx.db.query("tenants").withIndex("by_slug", (q) => q.eq("slug", "fixed-2")).collect()
      );
      expect(all).toHaveLength(1);
    });

    test("rejects bootstrap when slug already belongs to a different workosOrganizationId", async () => {
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
          name: "Impersonator",
          contactEmail: "imposter@fixed3.example",
          timezone: "Asia/Manila",
          workosOrganizationId: "org_other",
        })
      ).rejects.toThrow(/TENANT_MISMATCH/);
    });

    test("rejects bootstrap when workosOrganizationId already belongs to a different slug", async () => {
      const t = convexTest(schema, modules);
      await t.mutation(internal.tenants.bootstrapFixedTenant, {
        slug: "fixed-4",
        name: "Fixed 4",
        contactEmail: "admin@fixed4.example",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_fixed_4",
      });
      await expect(
        t.mutation(internal.tenants.bootstrapFixedTenant, {
          slug: "different-slug",
          name: "Different",
          contactEmail: "admin@fixed4.example",
          timezone: "Asia/Manila",
          workosOrganizationId: "org_fixed_4",
        })
      ).rejects.toThrow(/TENANT_MISMATCH/);
    });

    test("canonical production tenant is selected explicitly, never by first-row order", async () => {
      const t = convexTest(schema, modules);
      // Insert a noncanonical tenant first.
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
});
