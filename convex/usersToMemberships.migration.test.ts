/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/**
 * Phase 1.5 migration: every `users` row already carries a legacy
 * `tenantId`. Backfill that signal into one `tenantMemberships` row
 * per (user, tenant). The migration must be:
 * - idempotent (re-running yields no duplicate memberships)
 * - bounded (driven by an explicit `tenantId`, no full-table scans)
 * - role-aware (the configured owner email becomes `owner`,
 *   everything else becomes `player`; a configured list of Game
 *   Master emails becomes `game_master`)
 * - auditable (writes an audit log row per membership created)
 * - non-merging (a user row never collides with another via email)
 */
describe("usersToMemberships migration", () => {
  async function seedTenantAndUsers(
    t: ReturnType<typeof convexTest>,
    options: {
      slug: string;
      users: Array<{
        tokenIdentifier: string;
        workosUserId: string;
        email: string;
      }>;
    }
  ): Promise<{ tenantId: any; userIds: any[] }> {
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: `Migration Club ${options.slug}`,
        slug: options.slug,
        timezone: "Asia/Manila",
        workosOrganizationId: `org_migration_${options.slug}`,
        status: "active",
        contactEmail: `gm@${options.slug}.example`,
        createdAt: Date.now(),
      })
    );
    const userIds: any[] = [];
    for (const u of options.users) {
      const id = await t.run(async (ctx) =>
        ctx.db.insert("users", {
          tokenIdentifier: u.tokenIdentifier,
          workosUserId: u.workosUserId,
          email: u.email,
          emailNormalized: u.email.toLowerCase(),
          tenantId: tenantId as any,
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
        })
      );
      userIds.push(id);
    }
    return { tenantId, userIds };
  }

  test("creates exactly one membership per user with the configured owner role", async () => {
    const t = convexTest(schema, modules);
    const { tenantId, userIds } = await seedTenantAndUsers(t, {
      slug: "tenant-a",
      users: [
        { tokenIdentifier: "https://api.workos.com|owner-1", workosUserId: "u1", email: "owner1@example.com" },
        { tokenIdentifier: "https://api.workos.com|player-1", workosUserId: "u2", email: "player1@example.com" },
      ],
    });

    const result = await t.mutation(internal.migrations.usersToMemberships.backfillTenant, {
      tenantId: tenantId as any,
      ownerEmails: ["owner1@example.com"],
      gameMasterEmails: [],
    });

    expect(result.created).toBe(2);
    expect(result.memberships).toHaveLength(2);

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    expect(memberships).toHaveLength(2);

    const owner = memberships.find((m) => m.userId === userIds[0]);
    const player = memberships.find((m) => m.userId === userIds[1]);
    expect(owner?.role).toBe("owner");
    expect(player?.role).toBe("player");
  });

  test("assigns game_master role to configured staff emails", async () => {
    const t = convexTest(schema, modules);
    const { tenantId } = await seedTenantAndUsers(t, {
      slug: "tenant-b",
      users: [
        { tokenIdentifier: "https://api.workos.com|gm-1", workosUserId: "g1", email: "gm1@example.com" },
      ],
    });

    await t.mutation(internal.migrations.usersToMemberships.backfillTenant, {
      tenantId: tenantId as any,
      ownerEmails: [],
      gameMasterEmails: ["GM1@example.com"],
    });

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("game_master");
  });

  test("re-running the migration is idempotent and never duplicates memberships", async () => {
    const t = convexTest(schema, modules);
    const { tenantId } = await seedTenantAndUsers(t, {
      slug: "tenant-c",
      users: [
        { tokenIdentifier: "https://api.workos.com|idem-1", workosUserId: "i1", email: "i1@example.com" },
      ],
    });

    await t.mutation(internal.migrations.usersToMemberships.backfillTenant, {
      tenantId: tenantId as any,
      ownerEmails: [],
      gameMasterEmails: [],
    });
    const second = await t.mutation(internal.migrations.usersToMemberships.backfillTenant, {
      tenantId: tenantId as any,
      ownerEmails: [],
      gameMasterEmails: [],
    });

    expect(second.created).toBe(0);

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    expect(memberships).toHaveLength(1);
  });

  test("suspends users that do not match owner or game_master classification", async () => {
    // Phase 1.5 design: legacy users with no clear classification land
    // as suspended `player` memberships so they require explicit owner
    // review. They never auto-elevate.
    const t = convexTest(schema, modules);
    const { tenantId } = await seedTenantAndUsers(t, {
      slug: "tenant-d",
      users: [
        { tokenIdentifier: "https://api.workos.com|orphan-1", workosUserId: "o1", email: "orphan@example.com" },
      ],
    });

    await t.mutation(internal.migrations.usersToMemberships.backfillTenant, {
      tenantId: tenantId as any,
      ownerEmails: ["somebody-else@example.com"],
      gameMasterEmails: ["somebody-else-2@example.com"],
      suspendUnclassified: true,
    });

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    expect(memberships[0].role).toBe("player");
    expect(memberships[0].status).toBe("suspended");
  });

  test("bounded: never reads users outside the requested tenantId", async () => {
    const t = convexTest(schema, modules);
    // Tenant A with one user.
    const a = await seedTenantAndUsers(t, {
      slug: "tenant-e",
      users: [{ tokenIdentifier: "https://api.workos.com|e1", workosUserId: "e1", email: "e1@a.com" }],
    });
    // Tenant B with one user.
    const b = await seedTenantAndUsers(t, {
      slug: "tenant-f",
      users: [{ tokenIdentifier: "https://api.workos.com|f1", workosUserId: "f1", email: "f1@b.com" }],
    });

    await t.mutation(internal.migrations.usersToMemberships.backfillTenant, {
      tenantId: a.tenantId as any,
      ownerEmails: [],
      gameMasterEmails: [],
    });

    const aMemberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").withIndex("by_tenantId", (q) => q.eq("tenantId", a.tenantId as any)).collect()
    );
    const bMemberships = await t.run(async (ctx) =>
      ctx.db.query("tenantMemberships").withIndex("by_tenantId", (q) => q.eq("tenantId", b.tenantId as any)).collect()
    );
    expect(aMemberships).toHaveLength(1);
    expect(bMemberships).toHaveLength(0);
  });

  test("writes an audit log entry per membership created", async () => {
    const t = convexTest(schema, modules);
    const { tenantId } = await seedTenantAndUsers(t, {
      slug: "tenant-g",
      users: [
        { tokenIdentifier: "https://api.workos.com|audit-1", workosUserId: "au1", email: "au1@example.com" },
      ],
    });
    await t.mutation(internal.migrations.usersToMemberships.backfillTenant, {
      tenantId: tenantId as any,
      ownerEmails: [],
      gameMasterEmails: [],
    });
    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_tenantId_and_createdAt", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    const reconcileEntries = audits.filter((a) => a.action === "user.reconcile");
    expect(reconcileEntries.length).toBeGreaterThanOrEqual(1);
  });

  test("cursor advances past the first batch so a tenant with more users than batchSize fully backfills", async () => {
    // Regression: the old implementation re-read the same first
    // `batchSize` users on every invocation and returned hasMore:
    // true forever. This test seeds more users than one batch and
    // confirms the cursor drives the migration to completion.
    const t = convexTest(schema, modules);
    const { tenantId } = await seedTenantAndUsers(t, {
      slug: "tenant-paged",
      users: Array.from({ length: 7 }, (_, i) => ({
        tokenIdentifier: `https://api.workos.com|paged-${i}`,
        workosUserId: `paged_${i}`,
        email: `paged${i}@example.com`,
      })),
    });

    // batchSize 3 across 7 users → 3 batches (3 + 3 + 1).
    let cursor: string | null = null;
    let totalCreated = 0;
    let iterations = 0;
    for (;;) {
      iterations += 1;
      if (iterations > 10) throw new Error("backfill did not terminate");
      const result: { created: number; hasMore: boolean; cursor: string | null } = await t.mutation(
        internal.migrations.usersToMemberships.backfillTenant,
        {
          tenantId: tenantId as any,
          ownerEmails: [],
          gameMasterEmails: [],
          batchSize: 3,
          cursor: cursor ?? undefined,
        }
      );
      totalCreated += result.created;
      cursor = result.cursor;
      if (!result.hasMore) break;
    }

    expect(totalCreated).toBe(7);

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    expect(memberships).toHaveLength(7);
  });

  test("re-running backfill from a stale cursor is still idempotent (no duplicate memberships)", async () => {
    const t = convexTest(schema, modules);
    const { tenantId } = await seedTenantAndUsers(t, {
      slug: "tenant-idem-cursor",
      users: [
        { tokenIdentifier: "https://api.workos.com|ic-1", workosUserId: "ic1", email: "ic1@example.com" },
        { tokenIdentifier: "https://api.workos.com|ic-2", workosUserId: "ic2", email: "ic2@example.com" },
      ],
    });

    // First batch creates both.
    const first = await t.mutation(internal.migrations.usersToMemberships.backfillTenant, {
      tenantId: tenantId as any,
      ownerEmails: [],
      gameMasterEmails: [],
      batchSize: 1,
    });
    expect(first.created).toBe(1);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).not.toBeNull();

    // Replay the SAME cursor — the already-backed user is skipped via
    // the membership index, but the cursor still advances.
    const replay = await t.mutation(internal.migrations.usersToMemberships.backfillTenant, {
      tenantId: tenantId as any,
      ownerEmails: [],
      gameMasterEmails: [],
      batchSize: 1,
      cursor: first.cursor ?? undefined,
    });
    expect(replay.created).toBe(1); // the second user
    expect(replay.hasMore).toBe(false);

    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("tenantMemberships")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    expect(memberships).toHaveLength(2);
  });
});