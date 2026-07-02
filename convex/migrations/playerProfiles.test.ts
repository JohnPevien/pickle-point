/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

// This test lives in `convex/migrations/`. `import.meta.glob` relativizes
// keys to the importing file, which yields a mix of `./` (same-dir
// migration files) and `../` (everything else) prefixes. convex-test
// resolves function references against keys relative to the convex root,
// so we normalize every key to a convex-root-relative path before
// handing the map to `convexTest`. (Test files at the `convex/` root
// don't hit this because all their keys share one `./` prefix.)
const rawModules = import.meta.glob([
  "../**/*.ts",
  "!../**/*.test.ts",
  "!./**/*.test.ts",
]);
const THIS_DIR = "migrations/";
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([key, loader]) => {
    // `./x.ts`  -> the file is in this dir (migrations/) -> `migrations/x.ts`
    // `../y.ts` -> the file is at the convex root       -> `y.ts`
    // `../sub/z.ts` -> root-relative                     -> `sub/z.ts`
    const normalized = key.startsWith("./")
      ? THIS_DIR + key.slice(2)
      : key.replace(/^(\.\.\/)+/, "");
    return [normalized, loader];
  })
);

/**
 * Task 4.1 migration: widen legacy `players` rows into the account-backed
 * profile model. The migration must be:
 * - bounded (driven by an explicit `tenantId`, no full-table scans)
 * - cursor-based & resumable (each call returns a continuation cursor)
 * - idempotent (re-running yields no second patch and no duplicates)
 * - non-inferring (legacy rows are marked `legacy_unclaimed` and NEVER
 *   get a `userId` synthesized from contact data)
 * - preserving (already-valid account-backed profiles are left alone)
 * - duplicate-rejecting (two linked profiles for the same
 *   `(tenantId, userId)` are rejected so an operator must reconcile)
 */
describe("playerProfiles migration (Task 4.1)", () => {
  async function seedTenant(
    t: ReturnType<typeof convexTest>,
    slug: string
  ): Promise<any> {
    return t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: `Profile Club ${slug}`,
        slug,
        timezone: "Asia/Manila",
        workosOrganizationId: `org_profile_${slug}`,
        status: "active",
        contactEmail: `gm@${slug}.example`,
        createdAt: Date.now(),
      })
    );
  }

  /**
   * Insert a legacy (pre-4.1) player row exactly as the production data
   * looks today: required `firstName`/`lastName`/skill fields, no
   * `userId`, no `profileKind`. Optionally override fields so a test can
   * simulate an already-migrated or account-backed row.
   */
  async function seedLegacyPlayer(
    t: ReturnType<typeof convexTest>,
    tenantId: any,
    overrides: Record<string, any> = {}
  ): Promise<any> {
    return t.run(async (ctx) =>
      ctx.db.insert("players", {
        tenantId: tenantId as any,
        firstName: "Legacy",
        lastName: "Player",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        createdAt: Date.now(),
        ...overrides,
      })
    );
  }

  /**
   * Fetch a player row as `any`. `ctx.db.get` returns the union of all
   * table doc types; the test only asserts on players-specific fields, so
   * a cast keeps the assertions readable without a per-table narrowing.
   */
  async function getPlayer(
    t: ReturnType<typeof convexTest>,
    playerId: any
  ): Promise<any> {
    return t.run(async (ctx) => ctx.db.get(playerId));
  }

  test("a legacy profile becomes legacy_unclaimed", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "legacy-mark");

    const playerId = await seedLegacyPlayer(t, tenantId);

    const result = await t.mutation(
      internal.migrations.playerProfiles.backfillTenant,
      { tenantId: tenantId as any }
    );

    expect(result.patched).toBe(1);
    expect(result.isDone).toBe(true);

    const player = await getPlayer(t, playerId);
    expect(player?.profileKind).toBe("legacy_unclaimed");
    // Legacy rows are never linked to a user.
    expect(player?.userId).toBeUndefined();
  });

  test("an account-backed profile remains unchanged", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "preserve-account");
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: "https://api.workos.com|acct-1",
        workosUserId: "acct_1",
        email: "acct1@example.com",
        emailNormalized: "acct1@example.com",
        tenantId: tenantId as any,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    );

    const playerId = await seedLegacyPlayer(t, tenantId, {
      userId: userId as any,
      profileKind: "account",
      fullName: "Account Player",
      nickname: "ace",
      updatedAt: 1111,
    });

    const result = await t.mutation(
      internal.migrations.playerProfiles.backfillTenant,
      { tenantId: tenantId as any }
    );

    // Already-valid account row: nothing is written.
    expect(result.patched).toBe(0);

    const player = await getPlayer(t, playerId);
    expect(player?.profileKind).toBe("account");
    expect(player?.userId).toBe(userId);
    expect(player?.fullName).toBe("Account Player");
    expect(player?.nickname).toBe("ace");
    expect(player?.updatedAt).toBe(1111); // not stomped
  });

  test("legacy rows are never linked to a user during backfill", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "no-infer");

    // Seed several legacy rows with contact data that could be misused to
    // infer an identity. The migration must NOT synthesize a `userId`.
    const ids = await Promise.all(
      [
        { email: "infer1@example.com", phone: "+15550001" },
        { email: "infer2@example.com" },
      ].map((c) => seedLegacyPlayer(t, tenantId, c))
    );

    await t.mutation(internal.migrations.playerProfiles.backfillTenant, {
      tenantId: tenantId as any,
    });

    for (const id of ids) {
      const player = await getPlayer(t, id);
      expect(player?.userId).toBeUndefined();
      expect(player?.profileKind).toBe("legacy_unclaimed");
    }
  });

  test("duplicate (tenantId, userId) account-backed profiles are rejected (mutation throws CONFLICT)", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "dup-reject");
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: "https://api.workos.com|dup-1",
        workosUserId: "dup_1",
        email: "dup1@example.com",
        emailNormalized: "dup1@example.com",
        tenantId: tenantId as any,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    );

    // Two account-backed profiles for the SAME user in the SAME tenant
    // violate the "one account-backed profile per (tenantId, userId)"
    // invariant. The migration must throw so the transaction rolls back
    // and the operator reconciles — it must never complete successfully
    // with the invariant violated.
    const p1 = await seedLegacyPlayer(t, tenantId, {
      userId: userId as any,
      profileKind: "account",
      fullName: "Dup One",
      nickname: "dup1",
    });
    const p2 = await seedLegacyPlayer(t, tenantId, {
      userId: userId as any,
      profileKind: "account",
      fullName: "Dup Two",
      nickname: "dup2",
    });

    await expect(
      t.mutation(internal.migrations.playerProfiles.backfillTenant, {
        tenantId: tenantId as any,
      })
    ).rejects.toThrow(/CONFLICT/i);

    // Both offending rows are preserved exactly — the migration never
    // merges or deletes; it rolls back so the operator can fix the data.
    const p1Row = await getPlayer(t, p1);
    const p2Row = await getPlayer(t, p2);
    expect(p1Row?.profileKind).toBe("account");
    expect(p2Row?.profileKind).toBe("account");
    expect(p1Row?.userId).toBe(userId);
    expect(p2Row?.userId).toBe(userId);
  });

  test("transitional linked rows cannot hide a duplicate beyond a bounded lookup cap", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "dup-after-transitional");
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: "https://api.workos.com|dup-after-transitional",
        workosUserId: "dup_after_transitional",
        email: "dup-after-transitional@example.com",
        emailNormalized: "dup-after-transitional@example.com",
        tenantId: tenantId as any,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    );

    // These malformed transitional rows occupy the old `.take(8)` sample.
    // Any second row carrying the same tenant/user identity is already a
    // conflict, regardless of its temporary profileKind.
    for (let i = 0; i < 8; i++) {
      await seedLegacyPlayer(t, tenantId, {
        userId: userId as any,
        profileKind: "legacy_unclaimed",
        email: `transitional-${i}@example.com`,
      });
    }
    await seedLegacyPlayer(t, tenantId, {
      userId: userId as any,
      profileKind: "account",
      fullName: "Hidden Duplicate One",
      nickname: "hidden-one",
    });
    await seedLegacyPlayer(t, tenantId, {
      userId: userId as any,
      profileKind: "account",
      fullName: "Hidden Duplicate Two",
      nickname: "hidden-two",
    });

    await expect(
      t.mutation(internal.migrations.playerProfiles.backfillTenant, {
        tenantId: tenantId as any,
      })
    ).rejects.toThrow(/CONFLICT/i);
  });

  test("a single account-backed profile per (tenantId, userId) does not throw", async () => {
    // Companion to the rejection test: exactly one account profile is the
    // valid state, so the migration must complete without throwing and
    // without patching the already-valid row.
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "dup-ok");
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: "https://api.workos.com|dup-ok-1",
        workosUserId: "dup_ok_1",
        email: "dupok1@example.com",
        emailNormalized: "dupok1@example.com",
        tenantId: tenantId as any,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    );
    await seedLegacyPlayer(t, tenantId, {
      userId: userId as any,
      profileKind: "account",
      fullName: "Solo Account",
      nickname: "solo",
    });

    const result = await t.mutation(
      internal.migrations.playerProfiles.backfillTenant,
      { tenantId: tenantId as any }
    );
    expect(result.patched).toBe(0);
    expect(result.isDone).toBe(true);
  });

  test("re-running a completed migration is safe and idempotent", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "rerun-done");
    await seedLegacyPlayer(t, tenantId);
    await seedLegacyPlayer(t, tenantId, { email: "two@example.com" });

    const first = await t.mutation(
      internal.migrations.playerProfiles.backfillTenant,
      { tenantId: tenantId as any }
    );
    expect(first.patched).toBe(2);

    // Second full run: cursor starts fresh, but every row already has a
    // profileKind so none are patched again.
    const second = await t.mutation(
      internal.migrations.playerProfiles.backfillTenant,
      { tenantId: tenantId as any }
    );
    expect(second.patched).toBe(0);
    expect(second.isDone).toBe(true);

    const players = await t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    expect(players).toHaveLength(2);
    for (const p of players) {
      expect(p.profileKind).toBe("legacy_unclaimed");
    }
  });

  test("re-running from a partial cursor is safe and completes the migration", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "rerun-partial");
    // 4 legacy rows; batch size 1 forces 4 iterations.
    for (let i = 0; i < 4; i++) {
      await seedLegacyPlayer(t, tenantId, { email: `p${i}@example.com` });
    }

    let cursor: string | null = null;
    let totalPatched = 0;
    let iterations = 0;
    for (;;) {
      iterations += 1;
      if (iterations > 20) throw new Error("backfill did not terminate");
      const result: {
        patched: number;
        isDone: boolean;
        cursor: string | null;
      } = await t.mutation(
        internal.migrations.playerProfiles.backfillTenant,
        {
          tenantId: tenantId as any,
          batchSize: 1,
          cursor: cursor ?? undefined,
        }
      );
      totalPatched += result.patched;
      cursor = result.cursor;
      if (result.isDone) break;
    }

    expect(totalPatched).toBe(4);

    const players = await t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    expect(players).toHaveLength(4);
    for (const p of players) {
      expect(p.profileKind).toBe("legacy_unclaimed");
    }
  });

  test("a small batch limit returns a continuation cursor and subsequent batches complete the migration", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "batched");
    // 5 rows, batch of 2 -> first batch is not done.
    for (let i = 0; i < 5; i++) {
      await seedLegacyPlayer(t, tenantId, { email: `b${i}@example.com` });
    }

    const first = await t.mutation(
      internal.migrations.playerProfiles.backfillTenant,
      { tenantId: tenantId as any, batchSize: 2 }
    );
    expect(first.isDone).toBe(false);
    expect(first.cursor).not.toBeNull();
    expect(first.patched).toBe(2);

    // Walk remaining batches until done.
    let cursor = first.cursor;
    let totalPatched = first.patched;
    let lastIsDone = first.isDone;
    let iterations = 0;
    for (;;) {
      if (lastIsDone) break;
      iterations += 1;
      if (iterations > 20) throw new Error("backfill did not terminate");
      const result: {
        patched: number;
        isDone: boolean;
        cursor: string | null;
      } = await t.mutation(
        internal.migrations.playerProfiles.backfillTenant,
        {
          tenantId: tenantId as any,
          batchSize: 2,
          cursor: cursor ?? undefined,
        }
      );
      totalPatched += result.patched;
      cursor = result.cursor;
      lastIsDone = result.isDone;
    }

    expect(totalPatched).toBe(5);
    // Convex's native `.paginate()` signals completion via `isDone`; its
    // `continueCursor` is a sentinel (e.g. "_end_cursor"), not null, so we
    // assert on the done flag rather than the cursor value.
    expect(lastIsDone).toBe(true);

    const players = await t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId as any))
        .collect()
    );
    expect(players).toHaveLength(5);
  });

  test("existing populated fullName / nickname / updatedAt are not overwritten on a legacy row", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await seedTenant(t, "no-overwrite");
    const playerId = await seedLegacyPlayer(t, tenantId, {
      // A legacy row that already happens to carry some profile fields
      // (e.g. partially populated by an earlier pre-4.1 path) but has NO
      // profileKind yet. The migration must mark it legacy_unclaimed
      // without clobbering the existing populated values.
      fullName: "Preexisting Full",
      nickname: "prez",
      updatedAt: 4242,
    });

    const result = await t.mutation(
      internal.migrations.playerProfiles.backfillTenant,
      { tenantId: tenantId as any }
    );

    expect(result.patched).toBe(1);
    const player = await getPlayer(t, playerId);
    expect(player?.profileKind).toBe("legacy_unclaimed");
    expect(player?.fullName).toBe("Preexisting Full");
    expect(player?.nickname).toBe("prez");
    // updatedAt is refreshed to the backfill time only if the row is
    // actually patched; since it had a prior value, the existing value
    // is preserved (the migration must not stomp operator data).
    expect(player?.updatedAt).toBe(4242);
  });

  test("is bounded to the requested tenant and ignores other tenants", async () => {
    const t = convexTest(schema, modules);
    const tenantA = await seedTenant(t, "bounded-a");
    const tenantB = await seedTenant(t, "bounded-b");
    await seedLegacyPlayer(t, tenantA);
    await seedLegacyPlayer(t, tenantB);

    await t.mutation(internal.migrations.playerProfiles.backfillTenant, {
      tenantId: tenantA as any,
    });

    const aPlayers = await t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantA as any))
        .collect()
    );
    const bPlayers = await t.run(async (ctx) =>
      ctx.db
        .query("players")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantB as any))
        .collect()
    );
    expect(aPlayers[0].profileKind).toBe("legacy_unclaimed");
    expect(bPlayers[0].profileKind).toBeUndefined();
  });

  test("throws when the tenant row is missing (never selects a canonical tenant by default)", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.migrations.playerProfiles.backfillTenant, {
        tenantId: "k00000000000000000000000000" as any,
      })
    ).rejects.toThrow(/missing|tenant/i);
  });
});
