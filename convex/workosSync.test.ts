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
  // Per-user profile overrides. Tests can set
  // `__workosUserProfiles[userId] = { email: undefined }` to simulate a
  // user without a resolvable email (the fail-closed regression case).
  const __workosUserProfiles: Record<string, { email?: string; firstName?: string; lastName?: string }> = {};
  return {
    WorkOS: class {
      userManagement = {
        getUser: async (userId: string) => {
          // When an override entry exists for this user it is fully
          // authoritative — an explicit `email: undefined` means the
          // WorkOS profile has no resolvable email (the fail-closed
          // regression case). Without an override, return the default
          // mocked profile.
          const hasOverride = Object.prototype.hasOwnProperty.call(
            __workosUserProfiles,
            userId
          );
          const override = __workosUserProfiles[userId];
          return {
            id: userId,
            email: hasOverride ? override?.email : `${userId}@example.com`,
            firstName: hasOverride ? override?.firstName : "Mocked",
            lastName: hasOverride ? override?.lastName : "User",
            emailVerified: true,
            profilePictureUrl: null,
            createdAt: "2026-06-29T00:00:00Z",
            updatedAt: "2026-06-29T00:00:00Z",
          };
        },
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
    // Exposed for tests that need to shape the WorkOS profile response.
    __workosUserProfiles,
  };
});

// Typed handle to the mock's per-user profile override map.
const workosUserProfiles = (vi.mocked(await import("@workos-inc/node")) as unknown as {
  __workosUserProfiles: Record<string, { email?: string; firstName?: string; lastName?: string }>;
}).__workosUserProfiles;

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
  // Clear any per-user WorkOS profile overrides between tests.
  for (const key of Object.keys(workosUserProfiles)) {
    delete workosUserProfiles[key];
  }
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

  test("an updated event can provision an unseen user from the WorkOS profile", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    const updated: WirePayload = {
      id: "evt_unseen_update",
      event: "organization_membership.updated",
      data: {
        ...membershipCreatedPayload().data,
        id: "wos_membership_unseen",
        user_id: "user_unseen_update",
        role: { slug: "game_master" },
      },
    };

    await expect(
      t.action(internal.workosActions.ingestSignedWebhook, {
        rawBody: JSON.stringify(updated),
        signatureHeader: "valid",
        expectedOrganizationId: "org_unit_test",
      })
    ).resolves.toMatchObject({
      status: "applied",
      eventId: "evt_unseen_update",
    });

    const user = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) =>
          q.eq("workosUserId", "user_unseen_update")
        )
        .first()
    );
    expect(user).toMatchObject({
      email: "user_unseen_update@example.com",
      fullName: "Mocked User",
    });

    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_workosOrganizationMembershipId", (q) =>
          q.eq("workosOrganizationMembershipId", "wos_membership_unseen")
        )
        .first()
    );
    expect(membership).toMatchObject({ role: "game_master", status: "active" });
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

  // -------------------------------------------------------------------------
  // Phase 2 regression: never corrupt a real email with a synthetic
  // `<userId>@unknown.workos` placeholder. Membership role/status webhook
  // payloads carry no profile fields, so updates MUST preserve the real
  // email (and name) captured at login.
  // -------------------------------------------------------------------------

  test("a created event without a resolvable WorkOS email fails closed and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    // The WorkOS profile fetch returns no email for this user.
    workosUserProfiles["user_no_email"] = { email: undefined };

    const payload: WirePayload = {
      id: "evt_no_email",
      event: "organization_membership.created",
      data: {
        id: "wos_membership_no_email",
        organization_id: "org_unit_test",
        organization_name: "Unit Test Org",
        user_id: "user_no_email",
        status: "active",
        role: { slug: "player" },
      },
    };

    await expect(
      t.action(internal.workosActions.ingestSignedWebhook, {
        rawBody: JSON.stringify(payload),
        signatureHeader: "valid",
        expectedOrganizationId: "org_unit_test",
      })
    ).rejects.toThrow(/EMAIL_REQUIRED/);

    // Nothing persisted: no user, no membership, no receipt (the throw
    // happens before applyEvent runs, so WorkOS will retry).
    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    const receipts = await t.run(async (ctx) =>
      ctx.db.query("workosWebhookReceipts").collect()
    );
    expect(users).toHaveLength(0);
    expect(memberships).toHaveLength(0);
    expect(receipts).toHaveLength(0);
  });

  test("a role-only updated event preserves the real email captured at create", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    // 1. Create with a real email resolved from WorkOS.
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify({
        id: "evt_create_email",
        event: "organization_membership.created",
        data: {
          id: "wos_membership_email",
          organization_id: "org_unit_test",
          organization_name: "Unit Test Org",
          user_id: "user_email",
          status: "active",
          role: { slug: "player" },
        },
      }),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const afterCreate = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", "user_email"))
        .first()
    );
    expect(afterCreate?.email).toBe("user_email@example.com");
    expect(afterCreate?.emailNormalized).toBe("user_email@example.com");
    expect(afterCreate?.fullName).toBe("Mocked User");

    // 2. A role-only `updated` event arrives with no profile fields. Even
    //    if profile resolution later yields no email, the mutation must
    //    preserve the real email — never overwrite it with a placeholder.
    const updated: WirePayload = {
      id: "evt_role_only",
      event: "organization_membership.updated",
      data: {
        id: "wos_membership_email",
        organization_id: "org_unit_test",
        organization_name: "Unit Test Org",
        user_id: "user_email",
        status: "active",
        role: { slug: "game_master" },
      },
    };
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(updated),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const afterUpdate = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", "user_email"))
        .first()
    );
    // Email + name preserved; role applied.
    expect(afterUpdate?.email).toBe("user_email@example.com");
    expect(afterUpdate?.emailNormalized).toBe("user_email@example.com");
    expect(afterUpdate?.fullName).toBe("Mocked User");
    expect(afterUpdate?.email).not.toMatch(/@unknown\.workos$/);

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    expect(memberships[0].role).toBe("game_master");
  });

  test("a status-only updated event (pending) suspends but keeps the real email", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(membershipCreatedPayload()),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const updated: WirePayload = {
      id: "evt_status_only",
      event: "organization_membership.updated",
      data: { ...membershipCreatedPayload().data, status: "pending" },
    };
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(updated),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const user = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", "user_001"))
        .first()
    );
    // Real email survives; nothing synthetic written.
    expect(user?.email).toBe("user_001@example.com");
    expect(user?.email).not.toMatch(/@unknown\.workos$/);

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").collect()
    );
    expect(memberships[0].status).toBe("suspended");
  });

  test("never persists a synthetic @unknown.workos address on any path", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t);

    // Drive a full create → update → delete cycle.
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(membershipCreatedPayload()),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });
    const updated: WirePayload = {
      id: "evt_update_role",
      event: "organization_membership.updated",
      data: { ...membershipCreatedPayload().data, role: { slug: "game_master" } },
    };
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(updated),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });
    const deleted: WirePayload = {
      id: "evt_delete",
      event: "organization_membership.deleted",
      data: membershipCreatedPayload().data,
    };
    await t.action(internal.workosActions.ingestSignedWebhook, {
      rawBody: JSON.stringify(deleted),
      signatureHeader: "valid",
      expectedOrganizationId: "org_unit_test",
    });

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    for (const u of users) {
      expect(u.email).not.toMatch(/@unknown\.workos$/);
      if (u.emailNormalized) {
        expect(u.emailNormalized).not.toMatch(/@unknown\.workos$/);
      }
    }
  });
});
