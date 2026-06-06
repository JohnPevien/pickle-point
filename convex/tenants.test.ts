/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
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
  });

  describe("updateWorkspace", () => {
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
  });
});
