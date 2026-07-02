import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { finiteInt } from "../lib/num";

/**
 * Phase 4.1: widen legacy `players` rows into the account-backed profile
 * model introduced by the design spec.
 *
 * The migration is:
 * - **Explicitly tenant-scoped.** The caller supplies `tenantId`; the
 *   migration never selects a canonical tenant with `.first()` or scans
 *   another tenant's players.
 * - **Cursor-based & resumable.** Each invocation reads one bounded page
 *   via Convex's native `.paginate()` and returns its opaque
 *   `continueCursor`. The native cursor encodes the complete index
 *   position (tenantId, `_creationTime`, `_id`), so resuming cannot skip
 *   or re-read rows that share a `_creationTime` — a hazard with a
 *   hand-rolled `_creationTime`-only watermark. Pass `cursor` back until
 *   `isDone` is true.
 * - **Idempotent.** A row that already carries a `profileKind` is
 *   skipped, so re-running a finished (or partially finished) migration
 *   never double-patches or duplicates.
 * - **Non-inferring.** Legacy rows are marked `legacy_unclaimed` and
 *   NEVER receive a synthesized `userId`. The migration never looks up
 *   users by email/phone; identity linkage is Task 4.2's job.
 * - **Preserving.** Already-valid account-backed profiles (and any row
 *   that already has a `profileKind`) are left untouched. Populated
 *   `fullName`/`nickname`/`updatedAt` values on a legacy row are kept.
 * - **Duplicate-rejecting.** Two account-backed rows for the same
 *   `(tenantId, userId)` violate the spec's "one account-backed profile
 *   per user/tenant" invariant, so the migration THROWS and the
 *   transaction rolls back; the operator must reconcile the data. It
 *   never silently merges, deletes, or completes with a violation.
 *
 * It is invoked as an `internalMutation` (operator-driven, no cron).
 */

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

export const backfillTenant = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    scanned: number;
    patched: number;
    skippedAlreadyProfiled: number;
    isDone: boolean;
    cursor: string | null;
  }> => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant row missing during player-profile backfill");
    }

    const batchSize = finiteInt(
      args.batchSize ?? DEFAULT_BATCH_SIZE,
      1,
      MAX_BATCH_SIZE,
      DEFAULT_BATCH_SIZE
    );

    // Native pagination encodes the full index position (tenantId,
    // `_creationTime`, `_id`) in `continueCursor`, so a resumed run cannot
    // skip a row that ties on `_creationTime` with the previous batch's
    // last row. `.paginate()` on `by_tenantId` walks all of the tenant's
    // players in deterministic `_creationTime`/`_id` order.
    const page = await ctx.db
      .query("players")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("asc")
      .paginate({
        numItems: batchSize,
        cursor: args.cursor ?? null,
      });

    const now = Date.now();
    let scanned = 0;
    let patched = 0;
    let skippedAlreadyProfiled = 0;

    for (const player of page.page) {
      scanned += 1;

      // Idempotent: any row that already has a profileKind has been
      // processed by a prior run (or was created by the new account path).
      // Leave it exactly as-is.
      if (player.profileKind !== undefined) {
        // Guard the spec invariant before this batch returns success: two
        // account-backed rows for the same (tenantId, userId) cannot both
        // be valid. Throw so the whole transaction rolls back and the
        // operator reconciles; the migration never completes with a
        // violation. Detection is bounded to the users touched by this
        // page (at most `batchSize` account rows), each checked with one
        // indexed read.
        if (player.profileKind === "account" && player.userId !== undefined) {
          await assertNoDuplicateAccountProfile(ctx, args.tenantId, player.userId);
        }
        skippedAlreadyProfiled += 1;
        continue;
      }

      // Legacy row: mark it legacy_unclaimed. NEVER infer/attach a
      // userId. Preserve any already-populated profile fields an
      // operator or earlier path may have written (including `updatedAt`
      // — stamping it with `now` would clobber operator-authored data).
      const patch: {
        profileKind: "legacy_unclaimed";
        fullName?: string;
        nickname?: string;
        updatedAt?: number;
      } = {
        profileKind: "legacy_unclaimed",
      };
      if (player.fullName === undefined) {
        patch.fullName = `${player.firstName} ${player.lastName}`.trim();
      }
      if (player.nickname === undefined) {
        // A legacy row has no account nickname; fall back to the first
        // name so display code that reads `nickname` has a non-empty
        // value. This is NOT an identity inference — `userId` stays
        // unset. Task 4.2 lets the owning account rename it.
        patch.nickname = player.firstName;
      }
      if (player.updatedAt === undefined) {
        patch.updatedAt = now;
      }

      await ctx.db.patch(player._id, patch);
      patched += 1;
    }

    return {
      scanned,
      patched,
      skippedAlreadyProfiled,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

/**
 * Enforce the spec's "one account-backed profile per (tenantId, userId)"
 * invariant: throw a `CONFLICT` if more than one row is linked to this
 * user in this tenant. Convex secondary indexes do NOT
 * impose uniqueness, so this read inside the mutation transaction is the
 * enforcement point; throwing rolls back the whole batch so the operator
 * must reconcile the duplicate before the migration can proceed.
 */
async function assertNoDuplicateAccountProfile(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  userId: Id<"users">
): Promise<void> {
  // Bounded and definitive: any second row carrying the same tenant/user
  // identity violates the invariant, regardless of a transitional
  // `profileKind`. Reading two rows is therefore sufficient to prove a
  // conflict without sampling or scanning an unbounded result set.
  const candidates = await ctx.db
    .query("players")
    .withIndex("by_tenantId_and_userId", (q) =>
      q.eq("tenantId", tenantId).eq("userId", userId)
    )
    .take(2);
  if (candidates.length > 1) {
    throw new Error(
      `CONFLICT: user ${userId} has multiple linked player profiles in tenant ${tenantId}: ${candidates
        .map((p) => p._id)
        .join(", ")}. Reconcile before continuing the migration.`
    );
  }
}
