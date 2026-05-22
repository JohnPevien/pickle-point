/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("Users", () => {
  async function seedTenant(t: ReturnType<typeof convexTest>) {
    return await t.mutation(internal.tenants.seed, {
      name: "Test Club",
      contactEmail: "gm@testclub.com",
    });
  }

  describe("getCurrentUser", () => {
    test("returns null when there is no auth identity", async () => {
      const t = convexTest(schema, modules);
      const user = await t.query(api.users.getCurrentUser, {});
      expect(user).toBeNull();
    });

    test("returns the user matching the current identity", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          tokenIdentifier: "https://example.com|user-001",
          tenantId: tenantId as any,
          email: "gm@example.com",
          name: "Game Master",
          createdAt: Date.now(),
        });
      });

      const asUser = t.withIdentity({ tokenIdentifier: "https://example.com|user-001" });
      const user = await asUser.query(api.users.getCurrentUser, {});

      expect(user).not.toBeNull();
      expect(user?.email).toBe("gm@example.com");
      expect(user?.name).toBe("Game Master");
    });
  });

  describe("getOrCreateUser", () => {
    test("creates a new user when none exists", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      const userId = await t.mutation(internal.users.getOrCreateUser, {
        tokenIdentifier: "https://example.com|new-user",
        email: "new@example.com",
        name: "New User",
        tenantId: tenantId as any,
      });

      expect(userId).toBeDefined();
      const user = await t.run(async (ctx) => ctx.db.get(userId));
      expect(user?.email).toBe("new@example.com");
      expect(user?.name).toBe("New User");
    });

    test("updates existing user on subsequent calls", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      const userId = await t.mutation(internal.users.getOrCreateUser, {
        tokenIdentifier: "https://example.com|existing-user",
        email: "old@example.com",
        name: "Old Name",
        tenantId: tenantId as any,
      });

      const sameId = await t.mutation(internal.users.getOrCreateUser, {
        tokenIdentifier: "https://example.com|existing-user",
        email: "updated@example.com",
        name: "Updated Name",
        tenantId: tenantId as any,
      });

      expect(sameId).toBe(userId);
      const user = await t.run(async (ctx) => ctx.db.get(userId));
      expect(user?.email).toBe("updated@example.com");
      expect(user?.name).toBe("Updated Name");
    });
  });
});
