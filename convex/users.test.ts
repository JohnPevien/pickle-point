/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

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
          workosUserId: "user_001",
          email: "gm@example.com",
          emailNormalized: "gm@example.com",
          fullName: "Game Master",
          tenantId: tenantId as any,
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
        });
      });

      const asUser = t.withIdentity({ tokenIdentifier: "https://example.com|user-001" });
      const user = await asUser.query(api.users.getCurrentUser, {});

      expect(user).not.toBeNull();
      expect(user?.email).toBe("gm@example.com");
      expect(user?.fullName).toBe("Game Master");
    });
  });

  describe("getOrCreateUser", () => {
    test("creates a new user when none exists", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      const userId = await t.mutation(internal.users.getOrCreateUser, {
        tokenIdentifier: "https://example.com|new-user",
        workosUserId: "new_user_001",
        email: "new@example.com",
        emailNormalized: "new@example.com",
        fullName: "New User",
        tenantId: tenantId as any,
      });

      expect(userId).toBeDefined();
      const user = await t.run(async (ctx) => ctx.db.get(userId));
      expect(user?.email).toBe("new@example.com");
      expect(user?.fullName).toBe("New User");
      expect(user?.emailNormalized).toBe("new@example.com");
    });

    test("updates existing user on subsequent calls", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await seedTenant(t);

      const userId = await t.mutation(internal.users.getOrCreateUser, {
        tokenIdentifier: "https://example.com|existing-user",
        workosUserId: "existing_user_001",
        email: "old@example.com",
        emailNormalized: "old@example.com",
        fullName: "Old Name",
        tenantId: tenantId as any,
      });

      const sameId = await t.mutation(internal.users.getOrCreateUser, {
        tokenIdentifier: "https://example.com|existing-user",
        workosUserId: "existing_user_001",
        email: "updated@example.com",
        emailNormalized: "updated@example.com",
        fullName: "Updated Name",
        tenantId: tenantId as any,
      });

      expect(sameId).toBe(userId);
      const user = await t.run(async (ctx) => ctx.db.get(userId));
      expect(user?.email).toBe("updated@example.com");
      expect(user?.fullName).toBe("Updated Name");
    });
  });
});

// -------------------------------------------------------------------------
// Task 1.3: idempotent user and membership reconciliation
// -------------------------------------------------------------------------

describe("User/membership reconciliation", () => {
  test("creates a user and active membership on first reconciliation", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Reconcile Club",
        slug: "reconcile-club",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_reconcile",
        status: "active",
        contactEmail: "gm@reconcile.com",
        createdAt: Date.now(),
      })
    );

    const { userId, membershipId } = await t.mutation(
      internal.users.reconcileUserAndMembership,
      {
        tokenIdentifier: "https://api.workos.com|reconcile-001",
        workosUserId: "reconcile_user_001",
        email: "owner@reconcile.com",
        tenantId: tenantId as any,
        role: "owner",
        workosOrganizationMembershipId: "wos_001",
      }
    );

    expect(userId).toBeDefined();
    expect(membershipId).toBeDefined();

    const user = await t.run(async (ctx) => ctx.db.get(userId));
    expect(user).toMatchObject({
      tokenIdentifier: "https://api.workos.com|reconcile-001",
      workosUserId: "reconcile_user_001",
      email: "owner@reconcile.com",
      emailNormalized: "owner@reconcile.com",
      tenantId,
    });

    const membership = await t.run(async (ctx) => ctx.db.get(membershipId));
    expect(membership).toMatchObject({
      tenantId,
      userId,
      role: "owner",
      status: "active",
      workosOrganizationMembershipId: "wos_001",
    });
  });

  test("second reconciliation of the same identity is idempotent and updates fields", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Idempotent Club",
        slug: "idempotent-club",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_idempotent",
        status: "active",
        contactEmail: "gm@idempotent.com",
        createdAt: Date.now(),
      })
    );

    const first = await t.mutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: "https://api.workos.com|idempotent-001",
      workosUserId: "idempotent_user_001",
      email: "old@idempotent.com",
      tenantId: tenantId as any,
      role: "game_master",
      workosOrganizationMembershipId: "wos_first",
    });

    const second = await t.mutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: "https://api.workos.com|idempotent-001",
      workosUserId: "idempotent_user_001",
      email: "new@idempotent.com",
      fullName: "New Name",
      tenantId: tenantId as any,
      role: "owner",
      workosOrganizationMembershipId: "wos_second",
    });

    expect(second.userId).toBe(first.userId);
    expect(second.membershipId).toBe(first.membershipId);

    const user = await t.run(async (ctx) => ctx.db.get(second.userId));
    expect(user).toMatchObject({
      email: "new@idempotent.com",
      emailNormalized: "new@idempotent.com",
      fullName: "New Name",
    });

    const membership = await t.run(async (ctx) => ctx.db.get(second.membershipId));
    expect(membership).toMatchObject({
      role: "owner",
      workosOrganizationMembershipId: "wos_second",
    });
  });

  test("reconciliation normalizes email to lowercase", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Case Club",
        slug: "case-club",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_case",
        status: "active",
        contactEmail: "gm@case.com",
        createdAt: Date.now(),
      })
    );
    const { userId } = await t.mutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: "https://api.workos.com|case-001",
      workosUserId: "case_user_001",
      email: "Owner@CASE.COM",
      tenantId: tenantId as any,
      role: "player",
    });
    const user = await t.run(async (ctx) => ctx.db.get(userId));
    expect(user?.emailNormalized).toBe("owner@case.com");
  });

  test("reconciliation never merges by email alone — different identities stay distinct", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "No Merge Club",
        slug: "no-merge-club",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_no_merge",
        status: "active",
        contactEmail: "gm@nomerg.com",
        createdAt: Date.now(),
      })
    );
    const a = await t.mutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: "https://api.workos.com|a",
      workosUserId: "user_a",
      email: "shared@example.com",
      tenantId: tenantId as any,
      role: "player",
    });
    const b = await t.mutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: "https://api.workos.com|b",
      workosUserId: "user_b",
      email: "shared@example.com",
      tenantId: tenantId as any,
      role: "player",
    });
    expect(a.userId).not.toBe(b.userId);
  });

  test("reconciliation refuses to rebind a tokenIdentifier to a different workosUserId", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Conflict Club 1",
        slug: "conflict-club-1",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_conflict_1",
        status: "active",
        contactEmail: "gm@c1.com",
        createdAt: Date.now(),
      })
    );

    await t.mutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: "https://api.workos.com|rebind",
      workosUserId: "user_original",
      email: "rebind@example.com",
      tenantId: tenantId as any,
      role: "player",
    });

    // A second call attempts to bind the SAME tokenIdentifier to a
    // different WorkOS account. This must be rejected — silently
    // overwriting would hijack the original user's membership.
    await expect(
      t.mutation(internal.users.reconcileUserAndMembership, {
        tokenIdentifier: "https://api.workos.com|rebind",
        workosUserId: "user_impostor",
        email: "rebind@example.com",
        tenantId: tenantId as any,
        role: "player",
      })
    ).rejects.toThrow(/IDENTITY_CONFLICT/);

    // The original user row is untouched.
    const user = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", "https://api.workos.com|rebind")
        )
        .first()
    );
    expect(user?.workosUserId).toBe("user_original");
  });

  test("reconciliation refuses to create a second user that shares an existing workosUserId", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Conflict Club 2",
        slug: "conflict-club-2",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_conflict_2",
        status: "active",
        contactEmail: "gm@c2.com",
        createdAt: Date.now(),
      })
    );

    await t.mutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: "https://api.workos.com|first",
      workosUserId: "user_shared",
      email: "first@example.com",
      tenantId: tenantId as any,
      role: "player",
    });

    // A different tokenIdentifier tries to claim the same workosUserId.
    await expect(
      t.mutation(internal.users.reconcileUserAndMembership, {
        tokenIdentifier: "https://api.workos.com|second",
        workosUserId: "user_shared",
        email: "second@example.com",
        tenantId: tenantId as any,
        role: "player",
      })
    ).rejects.toThrow(/IDENTITY_CONFLICT/);

    const usersWithSharedId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", "user_shared"))
        .collect()
    );
    expect(usersWithSharedId).toHaveLength(1);
    expect(usersWithSharedId[0].tokenIdentifier).toBe("https://api.workos.com|first");
  });

  test("reconciliation supports the same user joining a second tenant (multi-tenant projection)", async () => {
    // Identity is global; a single WorkOS account may hold memberships
    // in more than one tenant. The user row stays singular; a second
    // membership row is created in the second tenant.
    const t = convexTest(schema, modules);
    const tenantA = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Tenant A",
        slug: "tenant-a",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_a",
        status: "active",
        contactEmail: "gm@a.com",
        createdAt: Date.now(),
      })
    );
    const tenantB = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Tenant B",
        slug: "tenant-b",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_b",
        status: "active",
        contactEmail: "gm@b.com",
        createdAt: Date.now(),
      })
    );

    const inA = await t.mutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: "https://api.workos.com|multi",
      workosUserId: "user_multi",
      email: "multi@example.com",
      tenantId: tenantA as any,
      role: "owner",
      workosOrganizationMembershipId: "wos_a",
    });
    const inB = await t.mutation(internal.users.reconcileUserAndMembership, {
      tokenIdentifier: "https://api.workos.com|multi",
      workosUserId: "user_multi",
      email: "multi@example.com",
      tenantId: tenantB as any,
      role: "game_master",
      workosOrganizationMembershipId: "wos_b",
    });

    // Same global user, distinct membership rows.
    expect(inA.userId).toBe(inB.userId);
    expect(inA.membershipId).not.toBe(inB.membershipId);

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", inA.userId))
        .collect()
    );
    expect(memberships).toHaveLength(2);
    const aMembership = memberships.find((m) => m.tenantId === tenantA);
    const bMembership = memberships.find((m) => m.tenantId === tenantB);
    expect(aMembership?.role).toBe("owner");
    expect(bMembership?.role).toBe("game_master");
  });
});
