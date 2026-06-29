import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Phase 1.5: bounded backfill of `users.tenantId` into the new
 * `tenantMemberships` table.
 *
 * Invariants:
 * - The migration is **explicitly tenant-scoped**: the caller supplies
 *   `tenantId` and the migration never scans other tenants.
 * - **Never selects the canonical tenant with `.first()`**. The tenant
 *   is provided by the caller (an internal bootstrap or operator).
 * - **Identity is never merged by email**. Each user row keeps its
 *   existing `tokenIdentifier` / `workosUserId` and the new membership
 *   is keyed on the existing `users._id`.
 * - **No silent admin elevation**: users that do not match the
 *   configured owner / Game Master email lists land as suspended
 *   `player` rows (configurable via `suspendUnclassified`).
 * - **Idempotent**: a `by_tenantId_and_userId` lookup short-circuits
 *   any user that already has a membership, so re-runs are safe.
 * - **Bounded and advancing**: reads via the `by_tenantId_and_createdAt`
 *   index with a `(creationTime, userId)` cursor so each invocation
 *   progresses past the previous batch. Re-running with the returned
 *   `cursor` walks the whole tenant without re-reading the first batch.
 */

/** Opaque cursor encoding `creationTime|userId` of the last row seen. */
type Cursor = { creationTime: number; userId: string };

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const sep = raw.indexOf("|");
  if (sep < 0) return null;
  const creationTime = Number(raw.slice(0, sep));
  if (!Number.isFinite(creationTime)) return null;
  return { creationTime, userId: raw.slice(sep + 1) };
}

function encodeCursor(c: Cursor): string {
  return `${c.creationTime}|${c.userId}`;
}

export const backfillTenant = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    ownerEmails: v.array(v.string()),
    gameMasterEmails: v.array(v.string()),
    suspendUnclassified: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    created: number;
    memberships: Id<"tenantMemberships">[];
    hasMore: boolean;
    cursor: string | null;
  }> => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant row missing during backfill");
    }

    const batchSize = Math.min(args.batchSize ?? 100, 500);
    const ownerSet = new Set(args.ownerEmails.map((e) => e.toLowerCase()));
    const gmSet = new Set(args.gameMasterEmails.map((e) => e.toLowerCase()));
    const cursor = decodeCursor(args.cursor);

    // Indexed scan by tenantId, ordered by _creationTime. The cursor
    // advances past the last processed row so the migration makes
    // progress across batches even when every candidate is skipped
    // (e.g. a retry that finds all users already backed).
    const candidateUsers = await ctx.db
      .query("users")
      .withIndex("by_tenantId", (qq) =>
        qq.eq("tenantId", args.tenantId).gt("_creationTime", cursor?.creationTime ?? -1)
      )
      .take(batchSize + 1);

    const hasMore = candidateUsers.length > batchSize;
    const page = hasMore ? candidateUsers.slice(0, batchSize) : candidateUsers;

    const created: Id<"tenantMemberships">[] = [];
    const now = Date.now();
    let lastSeen: Cursor | null = cursor;

    for (const user of page) {
      lastSeen = { creationTime: user._creationTime, userId: user._id };

      const existing = await ctx.db
        .query("tenantMemberships")
        .withIndex("by_tenantId_and_userId", (mq) =>
          mq.eq("tenantId", args.tenantId).eq("userId", user._id)
        )
        .first();
      if (existing) continue; // idempotent: skip already-backed users

      const email = (user.emailNormalized ?? user.email).toLowerCase();
      let role: "owner" | "game_master" | "player";
      let status: "active" | "suspended";
      if (ownerSet.has(email)) {
        role = "owner";
        status = "active";
      } else if (gmSet.has(email)) {
        role = "game_master";
        status = "active";
      } else {
        role = "player";
        status = args.suspendUnclassified === false ? "active" : "suspended";
      }

      const membershipId = await ctx.db.insert("tenantMemberships", {
        tenantId: args.tenantId,
        userId: user._id,
        role,
        status,
        workosOrganizationMembershipId: undefined,
        createdAt: now,
        updatedAt: now,
      });
      created.push(membershipId);

      await ctx.db.insert("auditLogs", {
        tenantId: args.tenantId,
        actorUserId: user._id,
        action: "user.reconcile",
        resourceType: "tenantMemberships",
        resourceId: membershipId,
        after: JSON.stringify({
          source: "migration.usersToMemberships",
          role,
          status,
        }),
        createdAt: now,
      });
    }

    return {
      created: created.length,
      memberships: created,
      hasMore,
      cursor: hasMore ? (lastSeen ? encodeCursor(lastSeen) : null) : null,
    };
  },
});