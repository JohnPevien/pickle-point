/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("Venues", () => {
  async function seedTenant(
    t: ReturnType<typeof convexTest>,
    override: Partial<{ name: string; contactEmail: string }> = {}
  ) {
    return await t.mutation(internal.tenants.seed, {
      name: override.name ?? "Test Club",
      contactEmail: override.contactEmail ?? "gm@testclub.com",
    });
  }

  async function seedVenue(
    t: ReturnType<typeof convexTest>,
    tenantId: Id<"tenants">,
    override: Partial<{ name: string; courtCount: number; address: string }> = {}
  ) {
    const result = await t.mutation(api.venues.createVenue, {
      tenantId,
      name: override.name ?? "Main Clubhouse",
      courtCount: override.courtCount ?? 8,
      address: override.address,
    });
    expect(result.success).toBe(true);
    return (result as { success: true; venueId: Id<"venues"> }).venueId;
  }

  test("creates, lists, updates, and deletes venues", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t);

    const createResult = await t.mutation(api.venues.createVenue, {
      tenantId: tenantId as any,
      name: "  Downtown Pickleball  ",
      courtCount: 6,
      address: "  123 Main St  ",
    });

    expect(createResult.success).toBe(true);
    const venueId = (createResult as { success: true; venueId: Id<"venues"> }).venueId;

    let venues = await t.query(api.venues.listByTenant, {
      tenantId: tenantId as any,
    });
    expect(venues).toHaveLength(1);
    expect(venues[0]).toMatchObject({
      name: "Downtown Pickleball",
      courtCount: 6,
      address: "123 Main St",
    });

    const updateResult = await t.mutation(api.venues.updateVenue, {
      tenantId: tenantId as any,
      venueId: venueId as any,
      name: "North Courts",
      courtCount: 10,
      address: "",
    });
    expect(updateResult.success).toBe(true);

    venues = await t.query(api.venues.listByTenant, {
      tenantId: tenantId as any,
    });
    expect(venues[0]).toMatchObject({
      name: "North Courts",
      courtCount: 10,
    });
    expect(venues[0].address).toBeUndefined();

    const deleteResult = await t.mutation(api.venues.deleteVenue, {
      tenantId: tenantId as any,
      venueId: venueId as any,
    });
    expect(deleteResult.success).toBe(true);

    const afterDelete = await t.query(api.venues.listByTenant, {
      tenantId: tenantId as any,
    });
    expect(afterDelete).toEqual([]);
  });

  test("handles invalid tenant and venue ids", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t);
    const venueId = await seedVenue(t, tenantId as Id<"tenants">);

    await t.run(async (ctx) => {
      await ctx.db.delete(tenantId as Id<"tenants">);
    });

    const venues = await t.query(api.venues.listByTenant, {
      tenantId: tenantId as any,
    });
    expect(venues).toEqual([]);

    const createResult = await t.mutation(api.venues.createVenue, {
      tenantId: tenantId as any,
      name: "Ghost Club",
      courtCount: 2,
    });
    expect(createResult.success).toBe(false);
    expect((createResult as any).error).toMatch(/tenant not found/i);

    await t.run(async (ctx) => {
      await ctx.db.delete(venueId);
    });

    const updateResult = await t.mutation(api.venues.updateVenue, {
      tenantId: tenantId as any,
      venueId: venueId as any,
      name: "Missing Venue",
    });
    expect(updateResult.success).toBe(false);
    expect((updateResult as any).error).toMatch(/venue not found/i);

    const deleteResult = await t.mutation(api.venues.deleteVenue, {
      tenantId: tenantId as any,
      venueId: venueId as any,
    });
    expect(deleteResult.success).toBe(false);
    expect((deleteResult as any).error).toMatch(/venue not found/i);
  });

  test("rejects tenant mismatches", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t);
    const otherTenantId = await seedTenant(t, {
      name: "Other Club",
      contactEmail: "other@testclub.com",
    });
    const venueId = await seedVenue(t, tenantId as Id<"tenants">);

    const updateResult = await t.mutation(api.venues.updateVenue, {
      tenantId: otherTenantId as any,
      venueId: venueId as any,
      name: "Wrong Workspace",
    });
    expect(updateResult.success).toBe(false);
    expect((updateResult as any).error).toMatch(/workspace mismatch/i);

    const deleteResult = await t.mutation(api.venues.deleteVenue, {
      tenantId: otherTenantId as any,
      venueId: venueId as any,
    });
    expect(deleteResult.success).toBe(false);
    expect((deleteResult as any).error).toMatch(/workspace mismatch/i);
  });

  test("rejects invalid venue inputs", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t);

    const blankName = await t.mutation(api.venues.createVenue, {
      tenantId: tenantId as any,
      name: "   ",
      courtCount: 4,
    });
    expect(blankName.success).toBe(false);
    expect((blankName as any).error).toMatch(/name is required/i);

    const zeroCourts = await t.mutation(api.venues.createVenue, {
      tenantId: tenantId as any,
      name: "Zero Court Club",
      courtCount: 0,
    });
    expect(zeroCourts.success).toBe(false);
    expect((zeroCourts as any).error).toMatch(/positive whole number/i);

    const decimalCourts = await t.mutation(api.venues.createVenue, {
      tenantId: tenantId as any,
      name: "Decimal Court Club",
      courtCount: 2.5,
    });
    expect(decimalCourts.success).toBe(false);
    expect((decimalCourts as any).error).toMatch(/positive whole number/i);

    const venueId = await seedVenue(t, tenantId as Id<"tenants">);
    const blankUpdate = await t.mutation(api.venues.updateVenue, {
      tenantId: tenantId as any,
      venueId: venueId as any,
      name: "",
    });
    expect(blankUpdate.success).toBe(false);
    expect((blankUpdate as any).error).toMatch(/name is required/i);

    const negativeUpdate = await t.mutation(api.venues.updateVenue, {
      tenantId: tenantId as any,
      venueId: venueId as any,
      courtCount: -1,
    });
    expect(negativeUpdate.success).toBe(false);
    expect((negativeUpdate as any).error).toMatch(/positive whole number/i);
  });

  test("blocks deleting a venue referenced by open play sessions", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t);
    const venueId = await seedVenue(t, tenantId as Id<"tenants">);

    await t.mutation(api.openPlaySessions.createSession, {
      tenantId: tenantId as any,
      venueId: venueId as any,
      name: "Friday Open Play",
      date: Date.now(),
      matchingMode: "auto_balanced",
    });

    const deleteResult = await t.mutation(api.venues.deleteVenue, {
      tenantId: tenantId as any,
      venueId: venueId as any,
    });

    expect(deleteResult.success).toBe(false);
    expect((deleteResult as any).error).toMatch(/open play session/i);
  });
});
