/**
 * Phase 2.2 — WorkOS webhook application logic.
 *
 * `applyEvent` is the only entry point that writes to the database
 * for verified webhook deliveries. It runs as a single Convex
 * mutation so the receipt row + user upsert + membership upsert +
 * audit row either all commit or all roll back. Duplicate event ids
 * are detected at the start of the mutation via the `by_eventId`
 * index.
 *
 * Membership deletion suspends access rather than deleting the user
 * history. An owner/Game Master can re-activate the membership by
 * re-creating the WorkOS membership; the user row is never lost.
 *
 * The `recordEvent` mutation is kept for unsupported event types
 * (the action layer records them with `status: "completed"` before
 * returning `skipped`).
 */

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";

type EventInput = {
  eventId: string;
  eventType: string;
  organizationId: string;
  membershipId: string;
  userId: string;
  role: "owner" | "game_master" | "player";
  membershipStatus: "active" | "suspended";
  email?: string;
  fullName?: string;
};

export const recordEvent = internalMutation({
  args: {
    event: v.object({
      eventId: v.string(),
      eventType: v.string(),
      status: v.union(
        v.literal("received"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed")
      ),
      receivedAt: v.number(),
      processedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workosWebhookReceipts")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.event.eventId))
      .first();

    if (existing) {
      // Duplicate delivery: bump attempts, preserve original outcome.
      // We do NOT overwrite a successful receipt with a later failure
      // and do NOT reapply side effects.
      await ctx.db.patch(existing._id, {
        attempts: existing.attempts + 1,
        lastError: args.event.lastError ?? existing.lastError,
      });
      return { duplicate: true, eventId: args.event.eventId };
    }

    await ctx.db.insert("workosWebhookReceipts", {
      eventId: args.event.eventId,
      eventType: args.event.eventType,
      status: args.event.status,
      attempts: 1,
      receivedAt: args.event.receivedAt,
      processedAt: args.event.processedAt,
      lastError: args.event.lastError,
    });

    return { duplicate: false, eventId: args.event.eventId };
  },
});

export const applyEvent = internalMutation({
  args: {
    event: v.object({
      eventId: v.string(),
      eventType: v.string(),
      organizationId: v.string(),
      membershipId: v.string(),
      userId: v.string(),
      role: v.union(v.literal("owner"), v.literal("game_master"), v.literal("player")),
      membershipStatus: v.union(v.literal("active"), v.literal("suspended")),
      email: v.optional(v.string()),
      fullName: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<{ status: "applied" | "duplicate"; eventId: string }> => {
    // Single transaction: detect duplicate, then write receipt + side
    // effects. Receipt insert happens AFTER membership writes so a
    // duplicate event never produces side effects.
    const existingReceipt = await ctx.db
      .query("workosWebhookReceipts")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.event.eventId))
      .first();
    if (existingReceipt && existingReceipt.status === "completed") {
      return { status: "duplicate", eventId: args.event.eventId };
    }

    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_workosOrganizationId", (q) =>
        q.eq("workosOrganizationId", args.event.organizationId)
      )
      .first();

    if (!tenant) {
      await writeReceipt(ctx, args.event, "failed", "TENANT_NOT_FOUND");
      throw new Error("TENANT_NOT_FOUND");
    }

    if (
      args.event.eventType === "organization_membership.created" ||
      args.event.eventType === "organization_membership.updated"
    ) {
      await ctx.runMutation(internal.users.reconcileUserAndMembership, {
        tokenIdentifier: `https://api.workos.com|${args.event.userId}`,
        workosUserId: args.event.userId,
        // Pass the profile email through only when present. The mutation
        // preserves any existing real email when this is omitted — a
        // role/status-only update must NEVER overwrite a real email with
        // a synthetic `<userId>@unknown.workos` placeholder.
        email: args.event.email,
        fullName: args.event.fullName,
        tenantId: tenant._id,
        role: args.event.role,
        workosOrganizationMembershipId: args.event.membershipId,
        // WorkOS is authoritative for membership lifecycle. `pending`
        // or `inactive` suspends locally; `active` re-activates.
        status: args.event.membershipStatus,
      });
    } else if (args.event.eventType === "organization_membership.deleted") {
      const membership = await ctx.db
        .query("tenantMemberships")
        .withIndex("by_workosOrganizationMembershipId", (q) =>
          q.eq("workosOrganizationMembershipId", args.event.membershipId)
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, {
          status: "suspended",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("auditLogs", {
          tenantId: membership.tenantId,
          actorUserId: membership.userId,
          action: "membership.suspend",
          resourceType: "tenantMemberships",
          resourceId: membership._id,
          before: JSON.stringify({ status: "active" }),
          after: JSON.stringify({
            status: "suspended",
            source: "workos.webhook",
            workosOrganizationMembershipId: args.event.membershipId,
          }),
          createdAt: Date.now(),
        });
      }
    }

    await writeReceipt(ctx, args.event, "completed", undefined);
    return { status: "applied", eventId: args.event.eventId };
  },
});

async function writeReceipt(
  ctx: MutationCtx,
  event: EventInput,
  status: "completed" | "failed",
  lastError: string | undefined
): Promise<void> {
  const existing = await ctx.db
    .query("workosWebhookReceipts")
    .withIndex("by_eventId", (q) => q.eq("eventId", event.eventId))
    .first();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      status,
      attempts: existing.attempts + 1,
      processedAt: now,
      lastError,
    });
  } else {
    await ctx.db.insert("workosWebhookReceipts", {
      eventId: event.eventId,
      eventType: event.eventType,
      status,
      attempts: 1,
      receivedAt: now,
      processedAt: now,
      lastError,
    });
  }
}