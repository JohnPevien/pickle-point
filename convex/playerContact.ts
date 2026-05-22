import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export function normalizeEmail(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

export function normalizePhone(value?: string) {
  const digits = value?.replace(/\D/g, "");
  return digits ? digits : undefined;
}

export function legacyContactValue(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueCandidates(...values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => !!value))];
}

export async function findPlayerByContact(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  contact: {
    email?: string;
    legacyEmail?: string;
    phone?: string;
    legacyPhone?: string;
  },
  excludePlayerId?: Id<"players">
): Promise<Doc<"players"> | null> {
  for (const email of uniqueCandidates(contact.email, contact.legacyEmail)) {
    const existing = await ctx.db
      .query("players")
      .withIndex("by_tenantId_and_email", (q) =>
        q.eq("tenantId", tenantId).eq("email", email)
      )
      .first();
    if (existing && existing._id !== excludePlayerId) {
      return existing;
    }
  }

  for (const phone of uniqueCandidates(contact.phone, contact.legacyPhone)) {
    const existing = await ctx.db
      .query("players")
      .withIndex("by_tenantId_and_phone", (q) =>
        q.eq("tenantId", tenantId).eq("phone", phone)
      )
      .first();
    if (existing && existing._id !== excludePlayerId) {
      return existing;
    }
  }

  return null;
}
