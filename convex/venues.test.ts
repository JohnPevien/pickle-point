/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

type Role = "owner" | "game_master" | "player";

/**
 * Build a WorkOS-shaped identity so the authz requireRole WorkOS-claim
 * validation passes. The membership row's workosOrganizationMembershipId
 * is derived from the same subject tag so the two line up.
 */
function asIdentity(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  options: { role?: Role; orgId?: string } = {}
) {
  const subjectTag = tokenIdentifier.replace(/[^a-zA-Z0-9]/g, "_");
  return t.withIdentity({
    tokenIdentifier,
    subject: subjectTag,
    issuer: "https://api.workos.com",
    name: "Game Master",
    email: "gm@testclub.com",
    organization_id: options.orgId ?? `org_${subjectTag}`,
    organization_membership_id: `wos_${subjectTag}`,
    role: options.role ?? "owner",
  });
}

/**
 * Bootstrap a tenant + user + active membership for the given role. The
 * membership's workosOrganizationMembershipId matches the identity built
 * by `asIdentity(tokenIdentifier, { role })` so the WorkOS claim check
 * in requireRole passes for owner/game_master.
 */
async function bootstrapTenantWithMembership(
  t: ReturnType<typeof convexTest>,
  options: {
    tokenIdentifier: string;
    role?: Role;
    slug?: string;
    name?: string;
    contactEmail?: string;
    workosOrganizationId?: string;
  }
): Promise<Id<"tenants">> {
  const role = options.role ?? "owner";
  const subjectTag = options.tokenIdentifier.replace(/[^a-zA-Z0-9]/g, "_");
  const orgId = options.workosOrganizationId ?? `org_${subjectTag}`;
  const result = await t.mutation(internal.tenants.bootstrapFixedTenant, {
    slug: options.slug ?? subjectTag,
    name: options.name ?? "Test Club",
    contactEmail: options.contactEmail ?? "gm@testclub.com",
    timezone: "Asia/Manila",
    workosOrganizationId: orgId,
  });
  await t.run(async (ctx) => {
    const tenantId = result.tenantId;
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: options.tokenIdentifier,
      workosUserId: `wos_${subjectTag}`,
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
      role,
      status: "active",
      workosOrganizationMembershipId: `wos_${subjectTag}`,
      createdAt: now,
      updatedAt: now,
    });
  });
  return result.tenantId;
}

/**
 * Insert a venue row directly (bypassing the mutation) so test fixtures
 * can seed venue data without coupling to the authed create path. The
 * real mutations are still exercised through the authed identity in the
 * CRUD test.
 */
async function seedVenueRow(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  override: Partial<{ name: string; courtCount: number; address: string }> = {}
): Promise<Id<"venues">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("venues", {
      tenantId,
      name: override.name ?? "Main Clubhouse",
      courtCount: override.courtCount ?? 8,
      address: override.address,
      createdAt: Date.now(),
    })
  );
}

describe("Venues", () => {
  // -------------------------------------------------------------------------
  // Task 3.1: venue CRUD still works for an authorized owner/game_master.
  // The happy path now runs through an authed identity; seed venues via
  // direct insert so the test focuses on the mutation behaviour itself.
  // -------------------------------------------------------------------------

  test("owner creates, lists, updates, and deletes venues", async () => {
    const t = convexTest(schema, modules);
    const token = "https://api.workos.com|owner-crud";
    const authed = asIdentity(t, token, { role: "owner" });
    const tenantId = await bootstrapTenantWithMembership(t, {
      tokenIdentifier: token,
      role: "owner",
    });

    const createResult = await authed.mutation(api.venues.createVenue, {
      tenantId,
      name: "  Downtown Pickleball  ",
      courtCount: 6,
      address: "  123 Main St  ",
    });

    expect(createResult.success).toBe(true);
    const venueId = (createResult as { success: true; venueId: Id<"venues"> }).venueId;

    let venues = await authed.query(api.venues.listByTenant, { tenantId });
    expect(venues).toHaveLength(1);
    expect(venues[0]).toMatchObject({
      name: "Downtown Pickleball",
      courtCount: 6,
      address: "123 Main St",
    });

    const updateResult = await authed.mutation(api.venues.updateVenue, {
      tenantId,
      venueId,
      name: "North Courts",
      courtCount: 10,
      address: "",
    });
    expect(updateResult.success).toBe(true);

    venues = await authed.query(api.venues.listByTenant, { tenantId });
    expect(venues[0]).toMatchObject({ name: "North Courts", courtCount: 10 });
    expect(venues[0].address).toBeUndefined();

    const deleteResult = await authed.mutation(api.venues.deleteVenue, {
      tenantId,
      venueId,
    });
    expect(deleteResult.success).toBe(true);

    const afterDelete = await authed.query(api.venues.listByTenant, { tenantId });
    expect(afterDelete).toEqual([]);
  });

  test("game_master can perform venue CRUD (allowed role)", async () => {
    const t = convexTest(schema, modules);
    const token = "https://api.workos.com|gm-crud";
    const authed = asIdentity(t, token, { role: "game_master" });
    const tenantId = await bootstrapTenantWithMembership(t, {
      tokenIdentifier: token,
      role: "game_master",
    });

    const createResult = await authed.mutation(api.venues.createVenue, {
      tenantId,
      name: "GM Courts",
      courtCount: 4,
    });
    expect(createResult.success).toBe(true);
    const venueId = (createResult as { success: true; venueId: Id<"venues"> }).venueId;

    const updateResult = await authed.mutation(api.venues.updateVenue, {
      tenantId,
      venueId,
      name: "GM Courts Renamed",
    });
    expect(updateResult.success).toBe(true);

    const deleteResult = await authed.mutation(api.venues.deleteVenue, {
      tenantId,
      venueId,
    });
    expect(deleteResult.success).toBe(true);
  });

  test("rejects invalid venue inputs (owner-authed)", async () => {
    const t = convexTest(schema, modules);
    const token = "https://api.workos.com|owner-validation";
    const authed = asIdentity(t, token, { role: "owner" });
    const tenantId = await bootstrapTenantWithMembership(t, {
      tokenIdentifier: token,
      role: "owner",
    });

    const blankName = await authed.mutation(api.venues.createVenue, {
      tenantId,
      name: "   ",
      courtCount: 4,
    });
    expect(blankName.success).toBe(false);
    expect((blankName as any).error).toMatch(/name is required/i);

    const zeroCourts = await authed.mutation(api.venues.createVenue, {
      tenantId,
      name: "Zero Court Club",
      courtCount: 0,
    });
    expect(zeroCourts.success).toBe(false);
    expect((zeroCourts as any).error).toMatch(/positive whole number/i);

    const decimalCourts = await authed.mutation(api.venues.createVenue, {
      tenantId,
      name: "Decimal Court Club",
      courtCount: 2.5,
    });
    expect(decimalCourts.success).toBe(false);
    expect((decimalCourts as any).error).toMatch(/positive whole number/i);

    const venueId = await seedVenueRow(t, tenantId);
    const blankUpdate = await authed.mutation(api.venues.updateVenue, {
      tenantId,
      venueId,
      name: "",
    });
    expect(blankUpdate.success).toBe(false);
    expect((blankUpdate as any).error).toMatch(/name is required/i);

    const negativeUpdate = await authed.mutation(api.venues.updateVenue, {
      tenantId,
      venueId,
      courtCount: -1,
    });
    expect(negativeUpdate.success).toBe(false);
    expect((negativeUpdate as any).error).toMatch(/positive whole number/i);
  });

  test("rejects operating on a missing venue (owner-authed)", async () => {
    const t = convexTest(schema, modules);
    const token = "https://api.workos.com|owner-missing";
    const authed = asIdentity(t, token, { role: "owner" });
    const tenantId = await bootstrapTenantWithMembership(t, {
      tokenIdentifier: token,
      role: "owner",
    });
    const venueId = await seedVenueRow(t, tenantId);

    await t.run(async (ctx) => {
      await ctx.db.delete(venueId);
    });

    const updateResult = await authed.mutation(api.venues.updateVenue, {
      tenantId,
      venueId,
      name: "Missing Venue",
    });
    expect(updateResult.success).toBe(false);
    expect((updateResult as any).error).toMatch(/venue not found/i);

    const deleteResult = await authed.mutation(api.venues.deleteVenue, {
      tenantId,
      venueId,
    });
    expect(deleteResult.success).toBe(false);
    expect((deleteResult as any).error).toMatch(/venue not found/i);
  });

  test("blocks deleting a venue referenced by open play sessions", async () => {
    const t = convexTest(schema, modules);
    const token = "https://api.workos.com|owner-referenced";
    const authed = asIdentity(t, token, { role: "owner" });
    const tenantId = await bootstrapTenantWithMembership(t, {
      tokenIdentifier: token,
      role: "owner",
    });
    const venueId = await seedVenueRow(t, tenantId);

    // The open play session mutation is not yet auth-hardened (Task 3.3),
    // so insert directly to set up the referencing row.
    await t.run(async (ctx) =>
      ctx.db.insert("openPlaySessions", {
        tenantId,
        venueId,
        name: "Friday Open Play",
        date: Date.now(),
        status: "draft",
        matchingMode: "auto_balanced",
        createdAt: Date.now(),
      })
    );

    const deleteResult = await authed.mutation(api.venues.deleteVenue, {
      tenantId,
      venueId,
    });

    expect(deleteResult.success).toBe(false);
    expect((deleteResult as any).error).toMatch(/open play session/i);
  });

  // -------------------------------------------------------------------------
  // Task 3.1: authorization gaps. These must fail closed for callers that
  // are not owner/game_master in the resource's tenant.
  // -------------------------------------------------------------------------

  describe("authorization (Phase 3.1)", () => {
    test("listByTenant rejects unauthenticated callers", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: "https://api.workos.com|owner-list-unauth",
        role: "owner",
      });

      await expect(
        t.query(api.venues.listByTenant, { tenantId })
      ).rejects.toThrow(/UNAUTHENTICATED|FORBIDDEN/);
    });

    test("listByTenant rejects a player", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|player-list";
      const authed = asIdentity(t, token, { role: "player" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "player",
      });

      await expect(
        authed.query(api.venues.listByTenant, { tenantId })
      ).rejects.toThrow(/FORBIDDEN/);
    });

    test("listByTenant rejects a member of a different tenant (cross-tenant resource id)", async () => {
      const t = convexTest(schema, modules);
      const tenantA = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: "https://api.workos.com|owner-a-list",
        role: "owner",
        slug: "club-a-list",
        workosOrganizationId: "org_club_a_list",
      });
      const tokenB = "https://api.workos.com|owner-b-list";
      const ownerB = asIdentity(t, tokenB, { role: "owner" });
      await bootstrapTenantWithMembership(t, {
        tokenIdentifier: tokenB,
        role: "owner",
        slug: "club-b-list",
        workosOrganizationId: "org_club_b_list",
      });

      // Owner B is an owner in tenant B but has no membership in tenantA.
      // Supplying tenantA's id must still be rejected.
      await expect(
        ownerB.query(api.venues.listByTenant, { tenantId: tenantA })
      ).rejects.toThrow(/FORBIDDEN/);
    });

    test("createVenue rejects unauthenticated callers", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: "https://api.workos.com|owner-create-unauth",
        role: "owner",
      });

      const result = await t.mutation(api.venues.createVenue, {
        tenantId,
        name: "Ghost Venue",
        courtCount: 2,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/UNAUTHENTICATED|FORBIDDEN/);
    });

    test("createVenue rejects a player", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|player-create";
      const authed = asIdentity(t, token, { role: "player" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "player",
      });

      const result = await authed.mutation(api.venues.createVenue, {
        tenantId,
        name: "Player Venue",
        courtCount: 2,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/FORBIDDEN/);
      // Nothing was written.
      const venues = await t.run(async (ctx) =>
        ctx.db.query("venues").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect()
      );
      expect(venues).toEqual([]);
    });

    test("createVenue rejects a member of a different tenant", async () => {
      const t = convexTest(schema, modules);
      const tenantA = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: "https://api.workos.com|owner-a-create",
        role: "owner",
        slug: "club-a-create",
        workosOrganizationId: "org_club_a_create",
      });
      const tokenB = "https://api.workos.com|owner-b-create";
      const ownerB = asIdentity(t, tokenB, { role: "owner" });
      await bootstrapTenantWithMembership(t, {
        tokenIdentifier: tokenB,
        role: "owner",
        slug: "club-b-create",
        workosOrganizationId: "org_club_b_create",
      });

      const result = await ownerB.mutation(api.venues.createVenue, {
        tenantId: tenantA,
        name: "Cross-tenant Venue",
        courtCount: 2,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/FORBIDDEN/);
    });

    test("updateVenue derives tenant from the venue (rejects cross-tenant resource ids)", async () => {
      // The caller is an owner in tenant A and supplies a foreign
      // tenantId (tenant B) alongside a venue that belongs to tenant A.
      // Authority is derived from the venue row, so the caller IS
      // authorized on the venue's tenant — but the stale client
      // tenantId must still be surfaced as a mismatch. Conversely, an
      // owner in tenant B attempting to update tenant A's venue must
      // be rejected by the derived-tenant authorization.
      const t = convexTest(schema, modules);
      const tenantA = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: "https://api.workos.com|owner-a-update",
        role: "owner",
        slug: "club-a-update",
        workosOrganizationId: "org_club_a_update",
      });
      const tokenB = "https://api.workos.com|owner-b-update";
      const ownerB = asIdentity(t, tokenB, { role: "owner" });
      const tenantB = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: tokenB,
        role: "owner",
        slug: "club-b-update",
        workosOrganizationId: "org_club_b_update",
      });
      const venueInA = await seedVenueRow(t, tenantA, { name: "Venue in A" });

      // 1. Owner B has no membership in tenant A → derived-tenant auth
      //    rejects the update even though they passed their own tenantB.
      const crossTenantResult = await ownerB.mutation(api.venues.updateVenue, {
        tenantId: tenantB,
        venueId: venueInA,
        name: "Hijacked",
      });
      expect(crossTenantResult.success).toBe(false);
      expect((crossTenantResult as any).error).toMatch(/FORBIDDEN|workspace mismatch/i);
      // Venue is unchanged.
      const stillA = await t.run(async (ctx) => ctx.db.get(venueInA));
      expect(stillA?.name).toBe("Venue in A");
    });

    test("deleteVenue rejects an owner of a different tenant via derived-tenant auth", async () => {
      const t = convexTest(schema, modules);
      const tenantA = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: "https://api.workos.com|owner-a-delete",
        role: "owner",
        slug: "club-a-delete",
        workosOrganizationId: "org_club_a_delete",
      });
      const tokenB = "https://api.workos.com|owner-b-delete";
      const ownerB = asIdentity(t, tokenB, { role: "owner" });
      const tenantB = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: tokenB,
        role: "owner",
        slug: "club-b-delete",
        workosOrganizationId: "org_club_b_delete",
      });
      const venueInA = await seedVenueRow(t, tenantA);

      const result = await ownerB.mutation(api.venues.deleteVenue, {
        tenantId: tenantB,
        venueId: venueInA,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/FORBIDDEN|workspace mismatch/i);
      // Venue is still present.
      const stillThere = await t.run(async (ctx) => ctx.db.get(venueInA));
      expect(stillThere).not.toBeNull();
    });

    test("updateVenue / deleteVenue reject unauthenticated callers", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: "https://api.workos.com|owner-unauth-update",
        role: "owner",
      });
      const venueId = await seedVenueRow(t, tenantId);

      const updateResult = await t.mutation(api.venues.updateVenue, {
        tenantId,
        venueId,
        name: "Unauth Update",
      });
      expect(updateResult.success).toBe(false);
      expect((updateResult as any).error).toMatch(/UNAUTHENTICATED|FORBIDDEN/);

      const deleteResult = await t.mutation(api.venues.deleteVenue, {
        tenantId,
        venueId,
      });
      expect(deleteResult.success).toBe(false);
      expect((deleteResult as any).error).toMatch(/UNAUTHENTICATED|FORBIDDEN/);
    });

    test("updateVenue / deleteVenue reject a player", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|player-mutate";
      const authed = asIdentity(t, token, { role: "player" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "player",
      });
      const venueId = await seedVenueRow(t, tenantId);

      const updateResult = await authed.mutation(api.venues.updateVenue, {
        tenantId,
        venueId,
        name: "Player Update",
      });
      expect(updateResult.success).toBe(false);
      expect((updateResult as any).error).toMatch(/FORBIDDEN/);

      const deleteResult = await authed.mutation(api.venues.deleteVenue, {
        tenantId,
        venueId,
      });
      expect(deleteResult.success).toBe(false);
      expect((deleteResult as any).error).toMatch(/FORBIDDEN/);
    });
  });
});
