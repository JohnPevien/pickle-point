"use node";

/**
 * Phase 2.2 — WorkOS webhook ingestion.
 *
 * This file is the only place in the Convex surface that handles the raw
 * webhook bytes and signature header. It runs in the Node.js runtime so
 * we can use the WorkOS Node SDK to verify the signature with the shared
 * secret. It then passes the verified, normalized payload into an internal
 * Convex mutation (the only path that may write to the database) so that
 * all authorization and idempotency decisions stay inside Convex.
 *
 * Security invariants:
 *  - The signature is verified against `WORKOS_WEBHOOK_SECRET` using the
 *    raw request bytes. A missing/incorrect secret or signature fails
 *    closed with INVALID_SIGNATURE before any database write.
 *  - The verified event's `organizationId` is compared against the
 *    canonical WorkOS organization id (resolved server-side). Webhooks
 *    that target a different organization fail closed with
 *    WRONG_ORGANIZATION.
 *  - Database writes happen exclusively through internal mutations
 *    (`internal.workosSync.*`). Browser-callable mutations never receive
 *    webhook data.
 *  - Duplicate event ids are detected via `workosWebhookReceipts` and
 *    return 200 without applying twice. The receipt is written before
 *    application so a failed processing attempt remains safely retryable.
 *
 * Shape notes (WorkOS Node SDK v9.3.1+):
 *  - `workos.webhooks.constructEvent` deserializes the wire payload into
 *    the SDK's camelCase internal types. Webhook data we receive here has
 *    `organizationId`, `userId`, `id`, `status` ("active"|"inactive"|
 *    "pending"), and `role` as a `RoleResponse` object with `.slug`.
 *  - The membership payload itself does NOT carry email/firstName/
 *    lastName. For membership create/update events and authenticated
 *    callback reconciliation, we resolve profile fields from the WorkOS
 *    API using a server-derived user id.
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { WorkOS } from "@workos-inc/node";

const SUPPORTED_EVENTS = new Set([
  "organization_membership.created",
  "organization_membership.updated",
  "organization_membership.deleted",
]);

type WorkOSRoleSlug = string;

type VerifiedMembershipData = {
  id: string;
  organizationId: string;
  userId: string;
  status: "active" | "inactive" | "pending" | string;
  role?: { slug?: WorkOSRoleSlug } | string;
  roles?: Array<{ slug?: WorkOSRoleSlug } | string>;
};

type VerifiedEvent = {
  id: string;
  event: string;
  data: Record<string, unknown>;
};

type WebhookSignatureVerifier = (
  rawBody: string,
  signatureHeader: string,
  secret: string,
) => VerifiedEvent | Promise<VerifiedEvent>;

const defaultVerifier: WebhookSignatureVerifier = async (rawBody, signatureHeader, secret) => {
  const workos = new WorkOS(secret);
  const event = await workos.webhooks.constructEvent({
    payload: rawBody,
    sigHeader: signatureHeader,
    secret,
  });
  // The SDK returns the deserialized event (camelCase fields, role object).
  // We keep only the fields we use so the rest of the file does not depend
  // on the SDK's exact shape.
  return event as unknown as VerifiedEvent;
};

const GLOBAL_KEY = Symbol.for("pickle-point.webhookVerifierOverride");
type GlobalWithVerifier = typeof globalThis & {
  [GLOBAL_KEY]?: WebhookSignatureVerifier | null;
};

export function __setWebhookSignatureVerifier(
  next: WebhookSignatureVerifier | null
): void {
  if (process.env.ALLOW_AUTH_TEST_BYPASS !== "1") {
    throw new Error(
      "Refusing to override webhook verifier outside test environments; set ALLOW_AUTH_TEST_BYPASS=1 to opt in.",
    );
  }
  (globalThis as GlobalWithVerifier)[GLOBAL_KEY] = next;
}

function getVerifierOverride(): WebhookSignatureVerifier | null {
  return (globalThis as GlobalWithVerifier)[GLOBAL_KEY] ?? null;
}

async function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): Promise<VerifiedEvent> {
  const verifier = getVerifierOverride() ?? defaultVerifier;
  return await verifier(rawBody, signatureHeader, secret);
}

function getWebhookSecret(): string {
  const secret = process.env.WORKOS_WEBHOOK_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(
      "WORKOS_WEBHOOK_SECRET is not configured; refusing to verify webhook signatures.",
    );
  }
  return secret;
}

function getWorkOSApiKey(): string {
  const key = process.env.WORKOS_API_KEY;
  if (!key || key.length === 0) {
    throw new Error("WORKOS_API_KEY is not configured");
  }
  return key;
}

/**
 * Extract a role slug from the WorkOS role field. The SDK returns it as
 * `{ slug: "owner" }` for the primary role, or `["admin"]` when the user
 * has multiple roles. Unknown slugs degrade to "player".
 */
function collectSlugs(field: unknown): string[] {
  if (typeof field === "string") return [field];
  if (Array.isArray(field)) {
    const out: string[] = [];
    for (const item of field) {
      if (typeof item === "string") out.push(item);
      else if (item && typeof item === "object" && "slug" in item && typeof (item as { slug: unknown }).slug === "string") {
        out.push((item as { slug: string }).slug);
      }
    }
    return out;
  }
  if (field && typeof field === "object" && "slug" in field && typeof (field as { slug: unknown }).slug === "string") {
    return [(field as { slug: string }).slug];
  }
  return [];
}

function normalizeRole(
  field: VerifiedMembershipData["role"] | VerifiedMembershipData["roles"]
): "owner" | "game_master" | "player" {
  const slugs = collectSlugs(field);

  // Owner/admin elevate. Game Master/gm/admin? WorkOS uses custom role
  // slugs; we treat owner/admin as owner, anything else with "gm" or
  // "game_master" as game_master, otherwise player.
  for (const slug of slugs) {
    const s = slug.toLowerCase();
    if (s === "owner" || s === "admin") return "owner";
  }
  for (const slug of slugs) {
    const s = slug.toLowerCase();
    if (s === "game_master" || s === "gm") return "game_master";
  }
  return "player";
}

/**
 * Map WorkOS membership status to our local active/suspended flag.
 *   active   → active
 *   pending  → suspended (awaiting acceptance)
 *   inactive → suspended
 *   unknown  → suspended (fail closed)
 */
function normalizeMembershipStatus(
  status: string
): "active" | "suspended" {
  return status === "active" ? "active" : "suspended";
}

/**
 * Normalize a verified WorkOS membership payload. Reads the camelCase
 * deserialized shape returned by `constructEvent`, not the raw wire
 * snake_case. Throws on missing required fields so the receipt layer
 * records a failure that WorkOS will retry.
 */
type NormalizedEvent = {
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

function readVerifiedMembershipData(data: Record<string, unknown>): VerifiedMembershipData {
  const organizationId =
    typeof data["organizationId"] === "string"
      ? (data["organizationId"] as string)
      : "";
  const membershipId = typeof data["id"] === "string" ? (data["id"] as string) : "";
  const userId = typeof data["userId"] === "string" ? (data["userId"] as string) : "";
  if (!organizationId) throw new Error("WEBHOOK_INVALID: missing organizationId");
  if (!membershipId) throw new Error("WEBHOOK_INVALID: missing membership id");
  if (!userId) throw new Error("WEBHOOK_INVALID: missing userId");

  const statusRaw = typeof data["status"] === "string" ? (data["status"] as string) : "unknown";
  const roleRaw = data["role"] as VerifiedMembershipData["role"] | undefined;
  const rolesRaw = data["roles"] as VerifiedMembershipData["roles"] | undefined;

  // Prefer the multi-role roles[] array when present.
  const normalizedRole = normalizeRole(rolesRaw ?? roleRaw);

  return {
    id: membershipId,
    organizationId,
    userId,
    status: statusRaw,
    role: normalizedRole,
  };
}

function normalizeVerifiedEvent(verified: VerifiedEvent): NormalizedEvent {
  const { id, event, data } = verified;
  if (!id) throw new Error("WEBHOOK_INVALID: missing event id");
  if (!event) throw new Error("WEBHOOK_INVALID: missing event type");

  const membership = readVerifiedMembershipData(data ?? {});
  return {
    eventId: id,
    eventType: event,
    organizationId: membership.organizationId,
    membershipId: membership.id,
    userId: membership.userId,
    role: membership.role as "owner" | "game_master" | "player",
    membershipStatus: normalizeMembershipStatus(membership.status),
  };
}

async function fetchWorkOSUser(
  workos: WorkOS,
  userId: string
): Promise<{ email?: string; fullName?: string }> {
  try {
    const user = await workos.userManagement.getUser(userId);
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return {
      email: user.email,
      fullName: fullName.length > 0 ? fullName : undefined,
    };
  } catch {
    // Network/auth failure should not block webhook application. The
    // caller falls back to empty profile fields.
    return {};
  }
}

/**
 * Resolve profile fields for a WorkOS user id that was derived from a
 * verified Convex identity. This stays internal and Node-only so browser
 * callers can never choose which WorkOS user is reconciled or access the
 * WorkOS API key.
 */
export const resolveUserProfile = internalAction({
  args: { workosUserId: v.string() },
  handler: async (_ctx, args): Promise<{ email: string | null; fullName: string | null }> => {
    const workos = new WorkOS(getWorkOSApiKey());
    const profile = await fetchWorkOSUser(workos, args.workosUserId);
    return {
      email: profile.email ?? null,
      fullName: profile.fullName ?? null,
    };
  },
});

export const ingestSignedWebhook = internalAction({
  args: {
    rawBody: v.string(),
    signatureHeader: v.string(),
    expectedOrganizationId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { status: "applied" | "duplicate"; eventId: string }
    | { status: "skipped"; eventId: string }
  > => {
    // 1. Verify signature using the WorkOS SDK. The SDK accepts the raw
    //    body bytes and a `workos-signature` header value. A bad secret
    //    or mismatched header is a hard fail.
    const secret = getWebhookSecret();
    let verified: VerifiedEvent;
    try {
      verified = await verifySignature(args.rawBody, args.signatureHeader, secret);
    } catch (error) {
      throw new Error(
        `INVALID_SIGNATURE: ${error instanceof Error ? error.message : "verification failed"}`,
      );
    }

    // 2. Reject events that target a different organization than the
    //    canonical WorkOS organization for this deployment. The
    //    organization id is compared server-side; the browser never
    //    controls it.
    const orgIdFromEvent =
      typeof verified.data?.["organizationId"] === "string"
        ? (verified.data["organizationId"] as string)
        : "";
    if (orgIdFromEvent !== args.expectedOrganizationId) {
      throw new Error("WRONG_ORGANIZATION");
    }

    // 3. Hand off to the internal mutation. Receipt write happens
    //    transactionally inside Convex so duplicate deliveries can be
    //    detected and safely retried.
    if (!SUPPORTED_EVENTS.has(verified.event)) {
      await ctx.runMutation(internal.workosSync.recordEvent, {
        event: {
          eventId: verified.id,
          eventType: verified.event,
          status: "completed",
          receivedAt: Date.now(),
          processedAt: Date.now(),
        },
      });
      return { status: "skipped" as const, eventId: verified.id };
    }

    const normalized = normalizeVerifiedEvent(verified);

    // 4. Fetch the user profile from WorkOS so create and update events
    //    can provision an unseen local user without inventing an email.
    //    If an update targets an existing user and the profile lookup is
    //    unavailable, the mutation preserves the stored profile fields.
    //    A create without a resolvable email fails closed so WorkOS retries.
    let email: string | undefined;
    let fullName: string | undefined;
    if (
      verified.event === "organization_membership.created" ||
      verified.event === "organization_membership.updated"
    ) {
      const workos = new WorkOS(getWorkOSApiKey());
      const user = await fetchWorkOSUser(workos, normalized.userId);
      email = user.email;
      fullName = user.fullName;
      if (verified.event === "organization_membership.created" && !email) {
        throw new Error("EMAIL_REQUIRED: cannot create user without a verified WorkOS email");
      }
    }

    const result = await ctx.runMutation(internal.workosSync.applyEvent, {
      event: {
        ...normalized,
        email,
        fullName,
      },
    });
    return result;
  },
});
