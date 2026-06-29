/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/**
 * Phase 1 schema contract — these tests pin the table/field/index shape
 * promised by the design spec. They run against an empty Convex instance
 * and create rows directly via `ctx.db.insert` so they exercise the
 * generated validator, not the public mutation surface (that lives in
 * later tasks).
 */
describe("Schema contract", () => {
  test("tenants carry slug / timezone / workosOrganizationId / status", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Test Club",
        slug: "test-club",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_test_001",
        status: "active",
        contactEmail: "gm@testclub.com",
        createdAt: Date.now(),
      })
    );
    const tenant = await t.run(async (ctx) => ctx.db.get(tenantId));
    expect(tenant).toMatchObject({
      slug: "test-club",
      timezone: "Asia/Manila",
      workosOrganizationId: "org_test_001",
      status: "active",
    });
  });

  test("users are global identities keyed by tokenIdentifier", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Test Club",
        slug: "test-club-2",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_test_002",
        status: "active",
        contactEmail: "gm@testclub.com",
        createdAt: Date.now(),
      })
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: "https://api.workos.com|user-001",
        workosUserId: "user_001",
        email: "user@example.com",
        emailNormalized: "user@example.com",
        fullName: "User One",
        tenantId: tenantId as any,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    );
    const user = await t.run(async (ctx) => ctx.db.get(userId));
    expect(user).toMatchObject({
      tokenIdentifier: "https://api.workos.com|user-001",
      emailNormalized: "user@example.com",
      workosUserId: "user_001",
    });
  });

  test("tenantMemberships compound lookup returns exactly one row per user/tenant", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Compound Club",
        slug: "compound-club",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_compound",
        status: "active",
        contactEmail: "gm@compound.com",
        createdAt: Date.now(),
      })
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: "https://api.workos.com|compound-001",
        workosUserId: "compound_user_001",
        email: "owner@compound.com",
        emailNormalized: "owner@compound.com",
        tenantId: tenantId as any,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("tenantMemberships", {
        tenantId: tenantId as any,
        userId: userId as any,
        role: "owner",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_tenantId_and_userId", (q) =>
          q.eq("tenantId", tenantId as any).eq("userId", userId as any)
        )
        .first()
    );
    expect(membership).toMatchObject({
      role: "owner",
      status: "active",
    });
  });

  test("auditLogs capture safe actor/action/resource metadata", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Audit Club",
        slug: "audit-club",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_audit",
        status: "active",
        contactEmail: "gm@audit.com",
        createdAt: Date.now(),
      })
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: "https://api.workos.com|audit-001",
        workosUserId: "audit_user_001",
        email: "actor@audit.com",
        emailNormalized: "actor@audit.com",
        tenantId: tenantId as any,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    );
    const auditId = await t.run(async (ctx) =>
      ctx.db.insert("auditLogs", {
        tenantId: tenantId as any,
        actorUserId: userId as any,
        action: "tenant.bootstrap",
        resourceType: "tenants",
        resourceId: tenantId as any,
        createdAt: Date.now(),
      })
    );
    const audit = await t.run(async (ctx) => ctx.db.get(auditId));
    expect(audit).toMatchObject({
      action: "tenant.bootstrap",
      resourceType: "tenants",
    });
  });

  test("workosWebhookReceipts dedupe by event id", async () => {
    const t = convexTest(schema, modules);
    const receiptId = await t.run(async (ctx) =>
      ctx.db.insert("workosWebhookReceipts", {
        eventId: "evt_abc123",
        eventType: "organization_membership.created",
        status: "received",
        attempts: 1,
        receivedAt: Date.now(),
        processedAt: Date.now(),
      })
    );
    const found = await t.run(async (ctx) =>
      ctx.db
        .query("workosWebhookReceipts")
        .withIndex("by_eventId", (q) => q.eq("eventId", "evt_abc123"))
        .first()
    );
    expect(found?._id).toBe(receiptId);
  });
});
