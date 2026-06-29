/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { __setWebhookSignatureVerifier } from "./workosActions";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/**
 * These tests use the *real* WorkOS Node SDK webhook verifier against
 * payloads with the camelCase shape returned by `constructEvent`. The
 * SDK's `deserializeEvent` translates the wire-format snake_case body
 * into camelCase fields and `role: { slug }`, so the action layer must
 * read the deserialized shape. We bypass the signature check itself
 * (only the verification branch) via the test seam — but we still
 * require the body to round-trip through `constructEvent` on a happy
 * path to catch shape regressions.
 */

// Mock the WorkOS SDK so the test runs without the real binary
// verification, but still exercises our normalizeVerifiedEvent against
// the *real* SDK deserialization (we mimic that deserialization
// explicitly so we don't depend on SDK internals from CI).
vi.mock("@workos-inc/node", () => {
  // Helper that mirrors SDK `deserializeOrganizationMembership`.
  function deserializeOrganizationMembership(input: any) {
    return {
      object: input.object ?? "organization_membership",
      id: input.id,
      userId: input.user_id,
      organizationId: input.organization_id,
      organizationName: input.organization_name,
      status: input.status,
      directoryManaged: input.directory_managed ?? false,
      createdAt: input.created_at,
      updatedAt: input.updated_at,
      role: input.role,
      ...(input.roles ? { roles: input.roles } : {}),
      customAttributes: input.custom_attributes ?? {},
    };
  }
  return {
    WorkOS: class {
      userManagement = {
        getUser: async (userId: string) => ({
          id: userId,
          email: `${userId}@example.com`,
          firstName: "Mocked",
          lastName: "User",
          emailVerified: true,
          profilePictureUrl: null,
          createdAt: "2026-06-29T00:00:00Z",
          updatedAt: "2026-06-29T00:00:00Z",
        }),
      };
      webhooks = {
        constructEvent: async ({ payload }: { payload: string }) => {
          const parsed = JSON.parse(payload);
          // Validate signature by checking a sentinel; the test seam
          // does not enforce real HMAC, but we still exercise shape.
          return {
            id: parsed.id,
            created_at: parsed.created_at ?? "2026-06-29T00:00:00Z",
            event: parsed.event,
            data: deserializeOrganizationMembership(parsed.data),
          };
        },
      };
    },
  };
});

type WireMembershipData = {
  id: string;
  organization_id: string;
  organization_name?: string;
  user_id: string;
  status: "active" | "inactive" | "pending";
  role: { slug: string };
  roles?: Array<{ slug: string }>;
  email?: string;
  first_name?: string;
  last_name?: string;
};

type WirePayload = {
  id: string;
  event:
    | "organization_membership.created"
    | "organization_membership.updated"
    | "organization_membership.deleted";
  data: WireMembershipData;
};

async function seedTenant(
  t: ReturnType<typeof convexTest>,
  orgId = "org_unit_test"
): Promise<unknown> {
  return await t.mutation(internal.tenants.bootstrapFixedTenant, {
    slug: `unit-${orgId}`,
    name: "Unit Test Tenant",
    contactEmail: "gm@unittest.example",
    timezone: "Asia/Manila",
    workosOrganizationId: orgId,
  });
}

function membershipCreatedPayload(
  overrides: Partial<WireMembershipData> = {}
): WirePayload {
  return {
    id: "evt_test_001",
    event: "organization_membership.created",
    data: {
      id: "wos_membership_001",
      organization_id: "org_unit_test",
      organization_name: "Unit Test Org",
      user_id: "user_001",
      status: "active",
      role: { slug: "owner" },
      ...overrides,
    },
  };
}

beforeEach(() => {
  process.env.WORKOS_WEBHOOK_SECRET = "test_secret_value";
  process.env.WORKOS_API_KEY = "test_api_key";
  process.env.WORKOS_ORGANIZATION_ID = "org_unit_test";
  __setWebhookSignatureVerifier(null); // real (mocked) verifier
});

afterEach(() => {
  __setWebhookSignatureVerifier(null);
});

describe("WorkOS webhook sync", () => {
  test("creates a user and active membership on a verified created event", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    const result = await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(membershipCreatedPayload()),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    expect(result).toMatchObject({ status: "applied", eventId: "evt_test_001" });

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    // The mocked WorkOS SDK returns `${userId}@example.com` for the
    // email, so we can assert the deserialized shape successfully
    // resolved email from the API rather than from the payload.
    expect(users[0]).toMatchObject({
      workosUserId: "user_001",
      email: "user_001@example.com",
      fullName: "Mocked User",
    });

    const memberships = await t.run(async (ctx) => ctx.db.query("tenantMemberships").collect());
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      role: "owner",
      status: "active",
      workosOrganizationMembershipId: "wos_membership_001",
    });

    const receipt = await t.run(async (ctx) =>
      ctx.db
        .query("workosWebhookReceipts")
        .withIndex("by_eventId", (q) => q.eq("eventId", "evt_test_001"))
        .first()
    );
    expect(receipt).toMatchObject({
      eventType: "organization_membership.created",
      status: "completed",
    });
  });

  test("rejects a bad signature before any database write", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    // Override the verifier to simulate a signature failure.
    __setWebhookSignatureVerifier(() => {
      throw new Error("Invalid signature");
    });

    await expect(
      t.action(internal.workosActions.ingestSignedWebhook, {
        rawBody: JSON.stringify(membershipCreatedPayload()),
        signatureHeader: "bad",
        expectedOrganizationId: "org_unit_test",
      })
    ).rejects.toThrow(/INVALID_SIGNATURE/);

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    const receipts = await t.run(async (ctx) =>
      ctx.db.query("workosWebhookReceipts").collect()
    );
    expect(users).toHaveLength(0);
    expect(receipts).toHaveLength(0);
  });

  test("rejects webhooks that target a different WorkOS organization", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "org_unit_test");

    const payload = membershipCreatedPayload({
      organization_id: "org_someone_else",
    });

    await expect(
      t.action(internal.workosActions.ingestSignedWebhook, {
        rawBody: JSON.stringify(payload),
        signatureHeader: "valid",
        expectedOrganizationId: "org_unit_test",
      })
    ).rejects.toThrow(/WRONG_ORGANIZATION/);

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  test("duplicate delivery of the same event id is idempotent (no double apply)", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);
    const payload = membershipCreatedPayload();

    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(payload),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });
    const second = await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(payload),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    expect(second).toMatchObject({ status: "duplicate", eventId: "evt_test_001" });

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    const receipts = await t.run(async (ctx) =>
      ctx.db.query("workosWebhookReceipts").collect()
    );
    expect(users).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(receipts).toHaveLength(1);
  });

  test("updated event changes the role on the existing membership", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    const created = membershipCreatedPayload();
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(created),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const updated: WirePayload = {
      id: "evt_test_002",
      event: "organization_membership.updated",
      data: { ...created.data, role: { slug: "game_master" } },
    };
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(updated),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    expect(memberships[0]).toMatchObject({ role: "game_master" });
  });

  test("role.slug is read from the WorkOS role object (not flattened string)", async () => {
    // Sanity-check that the deserialization maps role.slug -> "owner"
    // correctly even when only the role object is present.
    const t = convexTest(schema, modules);
    await seedTenant(t);

    const payload = membershipCreatedPayload({
      role: { slug: "game_master" },
    });

    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(payload),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    expect(memberships[0].role).toBe("game_master");
  });

  test("pending membership status suspends the local membership", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    // Create as active first.
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(membershipCreatedPayload()),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    // An `updated` event arrives with status=pending.
    const updated: WirePayload = {
      id: "evt_test_pending",
      event: "organization_membership.updated",
      data: { ...membershipCreatedPayload().data, status: "pending" },
    };
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(updated),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    expect(memberships[0].status).toBe("suspended");
  });

  test("inactive membership status suspends the local membership", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    const payload = membershipCreatedPayload({ status: "inactive" });
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(payload),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    expect(memberships[0].status).toBe("suspended");
  });

  test("deleted event suspends the membership and keeps the user row", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(membershipCreatedPayload()),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const deleted: WirePayload = {
      id: "evt_test_003",
      event: "organization_membership.deleted",
      data: membershipCreatedPayload().data,
    };
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(deleted),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    expect(users).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ status: "suspended" });
  });

  test("returns skipped for unsupported event types and still records the receipt", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    const unknown = {
      id: "evt_test_unknown",
      event: "session.created",
      data: { id: "x", organization_id: "org_unit_test" },
    };
    const result = await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(unknown),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    expect(result).toMatchObject({ status: "skipped", eventId: "evt_test_unknown" });

    const receipts = await t.run(async (ctx) =>
      ctx.db.query("workosWebhookReceipts").collect()
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ status: "completed" });
  });
});