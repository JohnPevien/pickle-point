/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/**
 * Phase 2.3 callback reconciliation action.
 *
 * `api.callback.reconcileWorkosCallback` is a public, token-authenticated
 * action taking NO arguments. It derives the WorkOS user id, organization,
 * role, and email exclusively from the authenticated identity and resolves
 * the fixed tenant server-side. These tests assert those invariants
 * against the real Convex identity plumbing.
 */
describe("callback.reconcileWorkosCallback", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.WORKOS_ORGANIZATION_ID = "org_callback";
    process.env.PICKLE_POINT_TENANT_SLUG = "callback-club";
  });

  afterEach(() => {
    // Restore a clean env between files; only delete keys we set here.
    delete process.env.WORKOS_ORGANIZATION_ID;
    delete process.env.PICKLE_POINT_TENANT_SLUG;
    process.env = { ...originalEnv };
  });

  async function seedTenantByOrg(t: ReturnType<typeof convexTest>) {
    return await t.mutation(internal.tenants.bootstrapFixedTenant, {
      slug: "callback-club",
      name: "Callback Club",
      contactEmail: "gm@callback.example",
      timezone: "Asia/Manila",
      workosOrganizationId: "org_callback",
    });
  }

  function identityFor(
    subject: string,
    overrides: Record<string, unknown> = {}
  ) {
    return {
      tokenIdentifier: `https://api.workos.com|${subject}`,
      subject,
      issuer: "https://api.workos.com",
      email: `${subject}@callback.example`,
      emailVerified: true,
      givenName: "Ada",
      familyName: "Lovelace",
      organization_id: "org_callback",
      ...overrides,
    };
  }

  test("returns unauthenticated when no identity is attached", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(api.callback.reconcileWorkosCallback, {});
    expect(result).toEqual({ status: "unauthenticated" });
  });

  test("reconciles an owner identity against the canonical tenant", async () => {
    const t = convexTest(schema, modules);
    await seedTenantByOrg(t);

    const authed = t.withIdentity(identityFor("user_owner", { role: "owner" }));
    const result = await authed.action(api.callback.reconcileWorkosCallback, {});

    expect(result).toEqual({ status: "ok" });

    const user = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", "user_owner"))
        .first()
    );
    expect(user).toMatchObject({
      email: "user_owner@callback.example",
      fullName: "Ada Lovelace",
    });
    const membership = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").first()
    );
    expect(membership).toMatchObject({ role: "owner", status: "active" });
  });

  test("maps admin and game_master/gm slugs correctly", async () => {
    const t = convexTest(schema, modules);
    await seedTenantByOrg(t);

    async function roleFor(subject: string, identityOverrides: Record<string, unknown>) {
      const authed = t.withIdentity(identityFor(subject, identityOverrides));
      await authed.action(api.callback.reconcileWorkosCallback, {});
      const user = await t.run(async (ctx) =>
        ctx.db
          .query("users")
          .withIndex("by_workosUserId", (q) => q.eq("workosUserId", subject))
          .first()
      );
      const membership = await t.run(async (ctx) =>
        ctx.db
          .query("tenantMemberships")
          .withIndex("by_userId", (q) => q.eq("userId", user!._id as any))
          .first()
      );
      return membership?.role;
    }

    // `admin` slug elevates to owner.
    expect(await roleFor("user_admin", { roles: ["admin"] })).toBe("owner");
    // `game_master` slug maps directly.
    expect(await roleFor("user_gm", { role: "game_master" })).toBe("game_master");
    // `gm` slug also maps to game_master.
    expect(await roleFor("user_gm_abbr", { role: "gm" })).toBe("game_master");
    // An unknown slug degrades to player.
    expect(await roleFor("user_other", { role: "something_else" })).toBe("player");
  });

  test("a personal-account session (no org claim) reconciles as a player via the canonical slug", async () => {
    const t = convexTest(schema, modules);
    await seedTenantByOrg(t);

    const authed = t.withIdentity(
      // No organization_id claim, no role claim.
      identityFor("user_player", { organization_id: undefined, role: undefined })
    );
    const result = await authed.action(api.callback.reconcileWorkosCallback, {});

    expect(result).toEqual({ status: "ok" });

    const user = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", "user_player"))
        .first()
    );
    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_userId", (q) => q.eq("userId", user!._id as any))
        .first()
    );
    expect(membership?.role).toBe("player");
  });

  test("a mismatched organization claim is forbidden and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedTenantByOrg(t);

    const authed = t.withIdentity(
      identityFor("user_cross", {
        organization_id: "org_someone_else",
        role: "owner",
      })
    );
    const result = await authed.action(api.callback.reconcileWorkosCallback, {});

    expect(result).toEqual({ status: "forbidden" });

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    expect(users).toHaveLength(0);
    expect(memberships).toHaveLength(0);
  });

  test("an unverified or missing email returns email_required and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedTenantByOrg(t);

    // Explicitly unverified email.
    const unverified = t.withIdentity(
      identityFor("user_unverified", { emailVerified: false })
    );
    expect(await unverified.action(api.callback.reconcileWorkosCallback, {})).toEqual({
      status: "email_required",
    });

    // No email claim at all.
    const noEmail = t.withIdentity(
      identityFor("user_no_email", { email: undefined, emailVerified: undefined })
    );
    expect(await noEmail.action(api.callback.reconcileWorkosCallback, {})).toEqual({
      status: "email_required",
    });

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  test("returns tenant_not_provisioned when the canonical org has no tenant and no slug fallback", async () => {
    const t = convexTest(schema, modules);
    // No tenant seeded, and remove the slug fallback.
    delete process.env.PICKLE_POINT_TENANT_SLUG;

    // Org claim points at an unprovisioned org; with no slug fallback,
    // there is no tenant to reconcile into.
    const authed = t.withIdentity(
      identityFor("user_unprovisioned", {
        organization_id: "org_callback",
        role: "owner",
      })
    );
    const result = await authed.action(api.callback.reconcileWorkosCallback, {});
    expect(result).toEqual({ status: "tenant_not_provisioned" });

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  test("never accepts user/org/tenant/role as arguments (empty args only)", async () => {
    // The action's validator must reject extraneous arguments. Passing
    // an identity but extra args should fail validation rather than
    // honoring browser-supplied identity fields.
    const t = convexTest(schema, modules);
    await seedTenantByOrg(t);

    const authed = t.withIdentity(identityFor("user_args", { role: "owner" }));
    await expect(
      authed.action(api.callback.reconcileWorkosCallback, {
        role: "owner",
        organizationId: "org_callback",
        workosUserId: "user_args",
      } as any)
    ).rejects.toThrow();
  });
});
