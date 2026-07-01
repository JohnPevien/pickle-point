/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

type Role = "owner" | "game_master" | "player";

/**
 * Build a WorkOS-shaped identity so the authz requireRole/requireOwnPlayer
 * WorkOS-claim validation passes. The membership row's
 * workosOrganizationMembershipId is derived from the same subject tag so
 * the two line up (mirrors the Task 3.1 venue test fixture).
 */
function asIdentity(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  options: { role?: Role; orgId?: string } = {}
) {
  const subjectTag = tokenIdentifier.replace(/[^a-zA-Z0-9]/g, "_");
  return t.withIdentity({
    tokenIdentifier,
    subject: subjectTag,
    issuer: "https://api.workos.com",
    name: "Admin",
    email: "admin@testclub.com",
    organization_id: options.orgId ?? `org_${subjectTag}`,
    organization_membership_id: `wos_${subjectTag}`,
    role: options.role ?? "owner",
  });
}

/**
 * Bootstrap a tenant + user + active membership for the given role. The
 * membership's workosOrganizationMembershipId matches the identity built
 * by `asIdentity(tokenIdentifier, { role })` so the WorkOS claim check in
 * requireRole passes for owner/game_master. Returns the tenantId; callers
 * wrap their own identity with `asIdentity`.
 */
async function bootstrapTenantWithMembership(
  t: ReturnType<typeof convexTest>,
  options: {
    tokenIdentifier: string;
    role?: Role;
    slug?: string;
    name?: string;
    contactEmail?: string;
    workosOrganizationId?: string;
  }
): Promise<Id<"tenants">> {
  const role = options.role ?? "owner";
  const subjectTag = options.tokenIdentifier.replace(/[^a-zA-Z0-9]/g, "_");
  const orgId = options.workosOrganizationId ?? `org_${subjectTag}`;
  const result = await t.mutation(internal.tenants.bootstrapFixedTenant, {
    slug: options.slug ?? subjectTag,
    name: options.name ?? "Test Club",
    contactEmail: options.contactEmail ?? "admin@testclub.com",
    timezone: "Asia/Manila",
    workosOrganizationId: orgId,
  });
  await t.run(async (ctx) => {
    const tenantId = result.tenantId;
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: options.tokenIdentifier,
      workosUserId: `wos_${subjectTag}`,
      email: "admin@testclub.com",
      emailNormalized: "admin@testclub.com",
      fullName: "Admin User",
      tenantId,
      createdAt: now,
      lastSeenAt: now,
    });
    await ctx.db.insert("tenantMemberships", {
      tenantId,
      userId,
      role,
      status: "active",
      workosOrganizationMembershipId: `wos_${subjectTag}`,
      createdAt: now,
      updatedAt: now,
    });
  });
  return result.tenantId;
}

/** Insert a player row directly so fixtures don't couple to the authed mutation. */
async function seedPlayerRow(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  override: Record<string, any> = {}
): Promise<Id<"players">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("players", {
      tenantId,
      firstName: override.firstName ?? "Jane",
      lastName: override.lastName ?? "Doe",
      skillSource: "manual",
      manualSkillLevel: "Novice",
      email: override.email,
      phone: override.phone,
      notes: override.notes,
      optIn: override.optIn,
      createdAt: Date.now(),
    });
  });
}

// Legacy alias kept for the few tests that still use `seedPlayer` semantics.
async function seedPlayer(
  t: ReturnType<typeof convexTest>,
  tenantId: any,
  override: Record<string, any> = {}
) {
  return seedPlayerRow(t, tenantId as Id<"tenants">, override);
}

async function seedTournament(t: ReturnType<typeof convexTest>, tenantId: any) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("tournaments", {
      tenantId,
      name: "Spring Classic",
      date: Date.now(),
      status: "registration_open",
      format: "round_robin",
      createdAt: Date.now(),
    });
  });
}

async function seedSession(t: ReturnType<typeof convexTest>, tenantId: any) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("openPlaySessions", {
      tenantId,
      name: "Tuesday Open Play",
      date: Date.now(),
      status: "draft",
      matchingMode: "auto_balanced",
      createdAt: Date.now(),
    });
  });
}

describe("Players", () => {
  // -------------------------------------------------------------------------
  // Business logic (preserved) — routed through an authed owner identity.
  // -------------------------------------------------------------------------

  describe("createPlayer", () => {
    test("creates a player and returns its id", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-create";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });

      const result = await authed.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "Alice",
        lastName: "Smith",
        skillSource: "manual",
        manualSkillLevel: "Beginner",
        email: "alice@example.com",
      });

      expect(result.success).toBe(true);
      expect((result as any).playerId).toBeDefined();
    });

    test("rejects duplicate email within the same tenant", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-dup-email";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      await seedPlayer(t, tenantId, { email: "dup@example.com" });

      const result = await authed.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "Bob",
        lastName: "Jones",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        email: "dup@example.com",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/email/i);
    });

    test("rejects duplicate phone within the same tenant", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-dup-phone";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      await seedPlayer(t, tenantId, { phone: "555-0001" });

      const result = await authed.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "Carol",
        lastName: "White",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        phone: "555-0001",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/phone/i);
    });
  });

  describe("registerTournamentTeam", () => {
    // NOTE: registerTournamentTeam hardening is Task 3.5 scope (it creates
    // accountless players from public registration). It is intentionally
    // left unauthenticated here and tested only for its existing behavior.
    test("rejects a team that resolves both slots to the same player", async () => {
      const t = convexTest(schema, modules);
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: "https://api.workos.com|owner-reg",
        role: "owner",
      });
      const tournamentId = await seedTournament(t, tenantId);
      await seedPlayer(t, tenantId, {
        firstName: "Same",
        lastName: "Player",
        email: "same@example.com",
      });

      const result = await t.mutation(api.players.registerTournamentTeam, {
        tenantId: tenantId as any,
        tournamentId: tournamentId as any,
        teamName: "Duplicate Team",
        skillTier: "Novice",
        player1: {
          firstName: "Same",
          lastName: "Player",
          email: "same@example.com",
        },
        player2: {
          firstName: "Same",
          lastName: "Player",
          email: " SAME@example.com ",
        },
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/different players/i);
    });
  });

  describe("getById", () => {
    test("returns an existing player to an owner", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-get";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId, { firstName: "Eve" });

      const player = await authed.query(api.players.getById, { playerId });

      expect(player).not.toBeNull();
      expect(player?.firstName).toBe("Eve");
    });

    test("throws RESOURCE_NOT_FOUND for a deleted player (no silent null)", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-get-missing";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(playerId);
      });

      await expect(
        authed.query(api.players.getById, { playerId })
      ).rejects.toThrow(/RESOURCE_NOT_FOUND/);
    });
  });

  describe("updatePlayer", () => {
    test("patches player fields", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-upd";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId, { firstName: "Frank" });

      const result = await authed.mutation(api.players.updatePlayer, {
        tenantId,
        playerId,
        firstName: "Franklin",
        manualSkillLevel: "Advanced",
      });

      expect(result.success).toBe(true);
      const updated = await authed.query(api.players.getById, { playerId });
      expect(updated?.firstName).toBe("Franklin");
      expect(updated?.manualSkillLevel).toBe("Advanced");
    });

    test("trims updated email and phone values", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-trim";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId, { firstName: "Trim" });

      const result = await authed.mutation(api.players.updatePlayer, {
        tenantId,
        playerId,
        email: " trim@example.com ",
        phone: " 555-1234 ",
      });

      expect(result.success).toBe(true);
      const updated = await authed.query(api.players.getById, { playerId });
      expect(updated?.email).toBe("trim@example.com");
      expect(updated?.phone).toBe("5551234");
    });

    test("rejects blank first and last names", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-blank";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });

      const blankFirstName = await authed.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "   ",
        lastName: "Smith",
        skillSource: "manual",
        manualSkillLevel: "Beginner",
      });
      expect(blankFirstName.success).toBe(false);
      expect((blankFirstName as any).error).toMatch(/first name/i);

      const blankLastName = await authed.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "Alice",
        lastName: "   ",
        skillSource: "manual",
        manualSkillLevel: "Beginner",
      });
      expect(blankLastName.success).toBe(false);
      expect((blankLastName as any).error).toMatch(/last name/i);
    });

    test("normalizes email and phone before duplicate checks", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-norm";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });

      await authed.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "Alice",
        lastName: "Smith",
        skillSource: "manual",
        manualSkillLevel: "Beginner",
        email: "Mixed.Case@Example.com",
        phone: "(555) 123-4567",
      });

      const emailDuplicate = await authed.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "Bob",
        lastName: "Jones",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        email: " mixed.case@example.com ",
      });
      expect(emailDuplicate.success).toBe(false);
      expect((emailDuplicate as any).error).toMatch(/email/i);

      const phoneDuplicate = await authed.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "Carol",
        lastName: "White",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        phone: "5551234567",
      });
      expect(phoneDuplicate.success).toBe(false);
      expect((phoneDuplicate as any).error).toMatch(/phone/i);
    });

    test("rejects duplicate email updates within the same tenant", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-upd-email";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      await seedPlayer(t, tenantId, { email: "taken@example.com" });
      const playerId = await seedPlayer(t, tenantId, { email: "available@example.com" });

      const result = await authed.mutation(api.players.updatePlayer, {
        tenantId,
        playerId,
        email: " taken@example.com ",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/email/i);
    });

    test("rejects duplicate phone updates within the same tenant", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-upd-phone";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      await seedPlayer(t, tenantId, { phone: "555-0001" });
      const playerId = await seedPlayer(t, tenantId, { phone: "555-0002" });

      const result = await authed.mutation(api.players.updatePlayer, {
        tenantId,
        playerId,
        phone: " 555-0001 ",
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/phone/i);
    });

    test("cannot alter the stored player's tenantId (immutable scope)", async () => {
      // The updatePlayer patch object only ever sets editable profile fields;
      // tenantId is never patched. Verify the stored tenantId is unchanged
      // after an update, even though tenantId is a legitimate input arg
      // (used only for the stale-client mismatch check).
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-immutable";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId, { firstName: "Scope" });

      const result = await authed.mutation(api.players.updatePlayer, {
        tenantId,
        playerId,
        firstName: "Scoped",
      });

      expect(result.success).toBe(true);
      const stored = await t.run(async (ctx) => ctx.db.get(playerId));
      expect(stored?.tenantId).toBe(tenantId);
      expect(stored?.firstName).toBe("Scoped");
    });
  });

  describe("deletePlayer", () => {
    test("removes a player", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-del";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId);

      const result = await authed.mutation(api.players.deletePlayer, {
        tenantId,
        playerId,
      });
      expect(result.success).toBe(true);

      await expect(
        authed.query(api.players.getById, { playerId })
      ).rejects.toThrow(/RESOURCE_NOT_FOUND/);
    });

    test("returns error when player does not exist", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-del-missing";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.delete(playerId);
      });

      const result = await authed.mutation(api.players.deletePlayer, {
        tenantId,
        playerId,
      });
      expect(result.success).toBe(false);
      // The derived-tenant helper throws RESOURCE_NOT_FOUND for a missing
      // player, which the mutation surfaces as `{success:false, error}`.
      expect((result as any).error).toMatch(/RESOURCE_NOT_FOUND|not found/i);
    });

    test("blocks delete when player is in a session", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-del-session";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const sessionId = await seedSession(t, tenantId);
      const playerId = await seedPlayer(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.insert("sessionPlayers", {
          sessionId: sessionId as any,
          playerId: playerId as any,
          status: "queued",
          checkedInAt: Date.now(),
        });
      });

      const result = await authed.mutation(api.players.deletePlayer, {
        tenantId,
        playerId,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/sessions/i);
    });

    test("blocks delete when player is a tournament entrant", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-del-entrant";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const tournamentId = await seedTournament(t, tenantId);
      const playerId = await seedPlayer(t, tenantId, { firstName: "Entrant" });
      const partnerId = await seedPlayer(t, tenantId, { firstName: "Partner" });

      await t.run(async (ctx) => {
        await ctx.db.insert("tournamentEntrants", {
          tournamentId: tournamentId as any,
          name: "Entrant Team",
          player1Id: partnerId as any,
          player2Id: playerId as any,
          skillTier: "Novice",
          createdAt: Date.now(),
        });
      });

      const result = await authed.mutation(api.players.deletePlayer, {
        tenantId,
        playerId,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/tournament entrants/i);
    });

    test("blocks delete when player appears in match history", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-del-history";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId, { firstName: "History" });
      const partnerId = await seedPlayer(t, tenantId, { firstName: "Partner" });

      await t.run(async (ctx) => {
        const matchHistoryId = await ctx.db.insert("matchHistory", {
          tenantId: tenantId as any,
          players: [playerId as any, partnerId as any],
          winners: [playerId as any],
          scores: [11, 7],
          playedAt: Date.now(),
        });
        // Phase 3.2: mirror into the reference table so the bounded
        // blocker can locate matches via a scalar index.
        await ctx.db.insert("matchHistoryParticipants", {
          matchHistoryId: matchHistoryId as any,
          tenantId: tenantId as any,
          playerId: playerId as any,
        });
      });

      const result = await authed.mutation(api.players.deletePlayer, {
        tenantId,
        playerId,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/match history/i);
    });

    test("blocks delete when player has stats snapshots", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-del-stats";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId, { firstName: "Stats" });

      await t.run(async (ctx) => {
        await ctx.db.insert("statsSnapshots", {
          tenantId: tenantId as any,
          playerId: playerId as any,
          wins: 1,
          losses: 0,
          pointsFor: 11,
          pointsAgainst: 3,
          snapshotDate: Date.now(),
        });
      });

      const result = await authed.mutation(api.players.deletePlayer, {
        tenantId,
        playerId,
      });

      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/stats/i);
    });
  });

  describe("getPlayerStats", () => {
    test("returns zeros when player has no stats snapshots", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-stats-zero";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId);

      const stats = await authed.query(api.players.getPlayerStats, { playerId });

      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(0);
      expect(stats.pointsFor).toBe(0);
      expect(stats.pointsAgainst).toBe(0);
    });

    test("aggregates across multiple snapshots", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-stats-agg";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId);

      await t.run(async (ctx) => {
        await ctx.db.insert("statsSnapshots", {
          tenantId: tenantId as any,
          playerId: playerId as any,
          wins: 3,
          losses: 1,
          pointsFor: 33,
          pointsAgainst: 22,
          snapshotDate: Date.now(),
        });
        await ctx.db.insert("statsSnapshots", {
          tenantId: tenantId as any,
          playerId: playerId as any,
          wins: 2,
          losses: 2,
          pointsFor: 20,
          pointsAgainst: 18,
          snapshotDate: Date.now(),
        });
      });

      const stats = await authed.query(api.players.getPlayerStats, { playerId });

      expect(stats.wins).toBe(5);
      expect(stats.losses).toBe(3);
      expect(stats.pointsFor).toBe(53);
      expect(stats.pointsAgainst).toBe(40);
    });

    test("bounds stats aggregation to the requested window", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-stats-window";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      const playerId = await seedPlayer(t, tenantId);
      const now = Date.now();

      await t.run(async (ctx) => {
        await ctx.db.insert("statsSnapshots", {
          tenantId: tenantId as any,
          playerId: playerId as any,
          wins: 10,
          losses: 0,
          pointsFor: 100,
          pointsAgainst: 10,
          snapshotDate: now - 2 * 86_400_000,
        });
        await ctx.db.insert("statsSnapshots", {
          tenantId: tenantId as any,
          playerId: playerId as any,
          wins: 1,
          losses: 1,
          pointsFor: 21,
          pointsAgainst: 18,
          snapshotDate: now,
        });
      });

      const stats = await authed.query(api.players.getPlayerStats, {
        playerId,
        windowDays: 1,
      });

      expect(stats.wins).toBe(1);
      expect(stats.losses).toBe(1);
      expect(stats.pointsFor).toBe(21);
      expect(stats.pointsAgainst).toBe(18);
    });
  });

  // -------------------------------------------------------------------------
  // Task 3.2: authorization boundary. Table-driven over the admin ops so
  // every role/operation combination is covered without duplicating setup.
  // -------------------------------------------------------------------------

  describe("authorization (Phase 3.2)", () => {
    test("validators do not accept identity-link fields (userId/_id/createdAt)", async () => {
      // The arg validators must not accept any identity-link/system field
      // (userId, WorkOS fields, _id, createdAt). Convex's validator rejects
      // unknown keys outright, so supplying one throws before the handler
      // runs — assert that rejection. This guards against a future field
      // being accidentally added to the arg validator.
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-validator";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });

      // createPlayer rejects an identity-link field (`userId`).
      // We deliberately bypass the type system here so the test
      // exercises Convex's runtime validator. The whole point of the
      // assertion is that the validator throws on unknown keys —
      // a passing TypeScript build would defeat the regression
      // guard. If Convex ever stops rejecting `userId`, this test
      // fails loudly.
      await expect(
        authed.mutation(api.players.createPlayer, {
          tenantId,
          firstName: "Link",
          lastName: "Attempt",
          skillSource: "manual",
          manualSkillLevel: "Beginner",
          // @ts-expect-error — userId is not a valid input
          userId: "fake_user_id",
        })
      ).rejects.toThrow(/userId/i);

      // A normal create stores no userId (there is no such field on the row).
      const created = await authed.mutation(api.players.createPlayer, {
        tenantId,
        firstName: "Link",
        lastName: "Attempt",
        skillSource: "manual",
        manualSkillLevel: "Beginner",
      });
      expect(created.success).toBe(true);
      const stored = await t.run(async (ctx) =>
        ctx.db.get((created as any).playerId)
      );
      expect((stored as any).userId).toBeUndefined();

      // updatePlayer rejects a system field (`createdAt`) and cannot alter
      // _id, tenantId, or createdAt through its editable-field patch.
      // See the createPlayer/userId test above for why we cast at the
      // call site and pair it with @ts-expect-error.
      const playerId = await seedPlayer(t, tenantId, { firstName: "Immutable" });
      await expect(
        authed.mutation(api.players.updatePlayer, {
          tenantId,
          playerId,
          firstName: "Immutable2",
          // @ts-expect-error — createdAt is not a valid input
          createdAt: 0,
        })
      ).rejects.toThrow(/createdAt/i);

      const original = await t.run(async (ctx) => ctx.db.get(playerId));
      const updated = await authed.mutation(api.players.updatePlayer, {
        tenantId,
        playerId,
        firstName: "Immutable2",
      });
      expect(updated.success).toBe(true);
      const after = await t.run(async (ctx) => ctx.db.get(playerId));
      expect(after?.createdAt).toBe(original?.createdAt);
      expect(after?.tenantId).toBe(original?.tenantId);
      expect(after?._id).toBe(original?._id);
    });

    type AdminOpSetup = {
      /** Build the args for this op given the tenant/player context. */
      build: (
        t: ReturnType<typeof convexTest>,
        tenantId: Id<"tenants">,
        playerId: Id<"players">
      ) => any;
      /** Run the op against a caller (authed identity or bare test handle). */
      run: (caller: any, args: any) => Promise<any>;
      /** Mutations return `{success:false,error}` on auth failure; queries throw. */
      isMutation: boolean;
    };

    /**
     * Assert an admin op rejects an unauthorized caller. Queries throw an
     * AppError; mutations resolve to `{ success:false, error }` so the admin
     * UI can toast. `pattern` matches the stable error code.
     */
    async function expectUnauthorized(
      op: AdminOpSetup,
      caller: any,
      args: any,
      pattern: RegExp
    ) {
      if (op.isMutation) {
        const result = await op.run(caller, args);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(pattern);
      } else {
        await expect(op.run(caller, args)).rejects.toThrow(pattern);
      }
    }

    const adminOps: { name: string; setup: AdminOpSetup }[] = [
      {
        name: "listByTenant",
        setup: {
          build: (_t, tenantId) => ({ tenantId }),
          run: (caller, args) => caller.query(api.players.listByTenant, args),
          isMutation: false,
        },
      },
      {
        name: "getById",
        setup: {
          build: (_t, _tenantId, playerId) => ({ playerId }),
          run: (caller, args) => caller.query(api.players.getById, args),
          isMutation: false,
        },
      },
      {
        name: "createPlayer",
        setup: {
          build: (_t, tenantId) => ({
            tenantId,
            firstName: "New",
            lastName: "Player",
            skillSource: "manual" as const,
            manualSkillLevel: "Novice" as const,
          }),
          run: (caller, args) => caller.mutation(api.players.createPlayer, args),
          isMutation: true,
        },
      },
      {
        name: "updatePlayer",
        setup: {
          build: (_t, tenantId, playerId) => ({ tenantId, playerId, firstName: "Changed" }),
          run: (caller, args) => caller.mutation(api.players.updatePlayer, args),
          isMutation: true,
        },
      },
      {
        name: "deletePlayer",
        setup: {
          build: (_t, tenantId, playerId) => ({ tenantId, playerId }),
          run: (caller, args) => caller.mutation(api.players.deletePlayer, args),
          isMutation: true,
        },
      },
      {
        name: "getPlayerStats",
        setup: {
          build: (_t, _tenantId, playerId) => ({ playerId }),
          run: (caller, args) => caller.query(api.players.getPlayerStats, args),
          isMutation: false,
        },
      },
    ];

    for (const op of adminOps) {
      describe(`${op.name}`, () => {
        test("owner is allowed", async () => {
          const t = convexTest(schema, modules);
          const token = "https://api.workos.com|owner-allow";
          const authed = asIdentity(t, token, { role: "owner" });
          const tenantId = await bootstrapTenantWithMembership(t, {
            tokenIdentifier: token,
            role: "owner",
          });
          const playerId = await seedPlayer(t, tenantId);
          const args = op.setup.build(t, tenantId, playerId);

          await expect(op.setup.run(authed, args)).resolves.toBeDefined();
        });

        test("game_master is allowed", async () => {
          const t = convexTest(schema, modules);
          const token = "https://api.workos.com|gm-allow";
          const authed = asIdentity(t, token, { role: "game_master" });
          const tenantId = await bootstrapTenantWithMembership(t, {
            tokenIdentifier: token,
            role: "game_master",
          });
          const playerId = await seedPlayer(t, tenantId);
          const args = op.setup.build(t, tenantId, playerId);

          await expect(op.setup.run(authed, args)).resolves.toBeDefined();
        });

        test("player is rejected with FORBIDDEN", async () => {
          const t = convexTest(schema, modules);
          const token = "https://api.workos.com|player-reject";
          const authed = asIdentity(t, token, { role: "player" });
          const tenantId = await bootstrapTenantWithMembership(t, {
            tokenIdentifier: token,
            role: "player",
          });
          const playerId = await seedPlayer(t, tenantId);
          const args = op.setup.build(t, tenantId, playerId);

          await expectUnauthorized(op.setup, authed, args, /FORBIDDEN/);
        });

        test("unauthenticated is rejected", async () => {
          const t = convexTest(schema, modules);
          const tenantId = await bootstrapTenantWithMembership(t, {
            tokenIdentifier: "https://api.workos.com|owner-unauth",
            role: "owner",
          });
          const playerId = await seedPlayer(t, tenantId);
          const args = op.setup.build(t, tenantId, playerId);

          await expectUnauthorized(op.setup, t, args, /UNAUTHENTICATED|FORBIDDEN/);
        });

        test("suspended member is rejected with MEMBERSHIP_SUSPENDED", async () => {
          const t = convexTest(schema, modules);
          const token = "https://api.workos.com|owner-suspended";
          const authed = asIdentity(t, token, { role: "owner" });
          const tenantId = await bootstrapTenantWithMembership(t, {
            tokenIdentifier: token,
            role: "owner",
          });
          // Suspend the owner's membership.
          await t.run(async (ctx) => {
            const user = await ctx.db
              .query("users")
              .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", token))
              .first();
            const membership = await ctx.db
              .query("tenantMemberships")
              .withIndex("by_tenantId_and_userId", (q) =>
                q.eq("tenantId", tenantId).eq("userId", user!._id)
              )
              .first();
            if (membership) await ctx.db.patch(membership._id, { status: "suspended" });
          });
          const playerId = await seedPlayer(t, tenantId);
          const args = op.setup.build(t, tenantId, playerId);

          await expectUnauthorized(op.setup, authed, args, /MEMBERSHIP_SUSPENDED/);
        });

        test("cross-tenant resource id is rejected with FORBIDDEN", async () => {
          // Owner of tenant B attempts to act on a player in tenant A.
          const t = convexTest(schema, modules);
          const tenantA = await bootstrapTenantWithMembership(t, {
            tokenIdentifier: "https://api.workos.com|owner-a-x",
            role: "owner",
            slug: "club-a-x",
            workosOrganizationId: "org_club_a_x",
          });
          const playerInA = await seedPlayer(t, tenantA);

          const tokenB = "https://api.workos.com|owner-b-x";
          const ownerB = asIdentity(t, tokenB, { role: "owner" });
          await bootstrapTenantWithMembership(t, {
            tokenIdentifier: tokenB,
            role: "owner",
            slug: "club-b-x",
            workosOrganizationId: "org_club_b_x",
          });

          // Build the op scoped to tenant A's resource but run it as owner B.
          const args = op.setup.build(t, tenantA, playerInA);
          await expectUnauthorized(op.setup, ownerB, args, /FORBIDDEN/);
        });
      });
    }

    test("player self-service on a player row fails closed (FORBIDDEN) — no ownership proof yet", async () => {
      // Until Task 4.1 wires players.userId, a player cannot prove they
      // own any player row. Every player-resource op must reject them.
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|player-self";
      const authed = asIdentity(t, token, { role: "player" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "player",
      });
      const playerId = await seedPlayer(t, tenantId, { firstName: "Self" });

      // Queries throw; mutations return {success:false}.
      await expect(
        authed.query(api.players.getById, { playerId })
      ).rejects.toThrow(/FORBIDDEN/);
      const upd = await authed.mutation(api.players.updatePlayer, {
        tenantId,
        playerId,
        firstName: "X",
      });
      expect(upd.success).toBe(false);
      expect(upd.error).toMatch(/FORBIDDEN/);
      const del = await authed.mutation(api.players.deletePlayer, { tenantId, playerId });
      expect(del.success).toBe(false);
      expect(del.error).toMatch(/FORBIDDEN/);
      await expect(
        authed.query(api.players.getPlayerStats, { playerId })
      ).rejects.toThrow(/FORBIDDEN/);
    });

    test("administrative player list returns full docs (admin-only); contact fields stay inside the admin boundary", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-list-private";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });
      // seedPlayerRow stores raw values (no normalization), so phone stays
      // as authored — listByTenant returns the stored doc verbatim.
      await seedPlayer(t, tenantId, {
        firstName: "Contact",
        email: "contact@example.com",
        phone: "555-9999",
        notes: "private note",
        optIn: true,
      });

      const playersPage = (await authed.query(api.players.listByTenant, { tenantId })) as {
        page: Array<Record<string, unknown>>;
      };
      const players = playersPage.page;

      expect(players).toHaveLength(1);
      expect(players[0].email).toBe("contact@example.com");
      expect(players[0].phone).toBe("555-9999");
      expect(players[0].notes).toBe("private note");
      // listByTenant is admin-only, so full docs are expected here. The
      // public boundary is enforced separately by stats.getLeaderboard.
    });
  });

  // -------------------------------------------------------------------------
  // Phase 3.2 review fixes: explicit truncation/pagination signal
  // instead of silent 500-cap slicing, and bounded deletion check.
  // -------------------------------------------------------------------------

  describe("listByTenant pagination (Phase 3.2 review)", () => {
    test("returns explicit truncation flag when more players exist beyond the cap", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-list-paged";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });

      // Seed > cap players so silent truncation would hide extras.
      // We use a smaller cap here to keep the test fast; what matters
      // is that the contract signals truncation rather than silently
      // dropping rows.
      const CAP = 5;
      const TOTAL = CAP + 3;
      for (let index = 0; index < TOTAL; index++) {
        await seedPlayer(t, tenantId, { firstName: `P${index}` });
      }

      const page = (await authed.query(api.players.listByTenant, {
        tenantId,
        limit: CAP,
      })) as { page: unknown[]; isDone: boolean; continueCursor: string };

      expect(page.page).toHaveLength(CAP);
      expect(page.isDone).toBe(false);
      expect(typeof page.continueCursor).toBe("string");

      // Follow the cursor to confirm extras really exist beyond cap.
      const next = (await authed.query(api.players.listByTenant, {
        tenantId,
        limit: CAP,
        paginationOpts: { numItems: CAP, cursor: page.continueCursor },
      })) as { page: unknown[]; isDone: boolean };

      expect(next.page.length).toBeGreaterThan(0);
      expect(next.page.length).toBeLessThanOrEqual(CAP);
    });
  });

  describe("deletePlayer blocker (Phase 3.2 review)", () => {
    test("blocks deletion with large match-history without an unbounded table scan", async () => {
      const t = convexTest(schema, modules);
      const token = "https://api.workos.com|owner-bounded-delete";
      const authed = asIdentity(t, token, { role: "owner" });
      const tenantId = await bootstrapTenantWithMembership(t, {
        tokenIdentifier: token,
        role: "owner",
      });

      const playerId = await seedPlayer(t, tenantId, { firstName: "Veteran" });
      const otherPlayer = await seedPlayer(t, tenantId, { firstName: "Opponent" });

      // 200 matchHistory rows the player participates in. With a proper
      // index-backed scan, deletion should still detect the blocker
      // promptly even when the table is large.
      await t.run(async (ctx) => {
        for (let index = 0; index < 200; index++) {
          const matchId = await ctx.db.insert("matchHistory", {
            tenantId,
            players: [playerId, otherPlayer],
            scores: [11, 9],
            winners: [playerId],
            playedAt: Date.now() - index * 60_000,
          });
          // Mirror reference rows so the by_playerId index can find
          // them via an index-backed lookup. This is the schema
          // migration introduced in Phase 3.2.
          await ctx.db.insert("matchHistoryParticipants", {
            matchHistoryId: matchId,
            tenantId,
            playerId,
          });
        }
      });

      const result = await authed.mutation(api.players.deletePlayer, {
        tenantId,
        playerId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.toLowerCase()).toContain("match");
      }
    });
  });
});
