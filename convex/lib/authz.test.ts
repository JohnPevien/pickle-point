/* eslint-disable @typescript-eslint/no-explicit-any */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"]);

/**
 * Phase 1.2 contract: every helper resolves users server-side through
 * `identity.tokenIdentifier`, never accepts browser-supplied IDs as
 * authority, throws stable error codes that match the spec's
 * UNAUTHENTICATED / FORBIDDEN / MEMBERSHIP_SUSPENDED / PROFILE_REQUIRED /
 * RESOURCE_NOT_FOUND / TENANT_MISMATCH vocabulary, and validates the
 * trusted WorkOS organization/role claims for owner/Game Master.
 */

type WorkOSIdentityOverrides = {
  organization_id?: string;
  organization_membership_id?: string;
  role?: string | string[];
  issuer?: string;
  subject?: string;
  noClaims?: boolean;
  /** When set, default `organization_membership_id` is
   *  `wos_<subjectTag>_<roleArg>` — matches the membership row created
   *  by `insertMembership` in the test fixture. */
  forRole?: "owner" | "game_master" | "player";
};

function workosIdentityFor(
  subjectTag: string,
  overrides: WorkOSIdentityOverrides = {}
): any {
  const tokenIdentifier = `https://api.workos.com|${subjectTag}`;
  const id: Record<string, unknown> = {
    tokenIdentifier,
    subject: overrides.subject ?? subjectTag,
    issuer: overrides.issuer ?? "https://api.workos.com",
    name: subjectTag,
    email: `${subjectTag}@example.com`,
  };
  if (!overrides.noClaims) {
    id["organization_id"] = overrides.organization_id ?? `org_${subjectTag}`;
    id["organization_membership_id"] =
      overrides.organization_membership_id ??
      (overrides.forRole ? `wos_${subjectTag}_${overrides.forRole}` : `wos_${subjectTag}`);
    if (overrides.role !== undefined) {
      id["roles"] = Array.isArray(overrides.role)
        ? overrides.role
        : [overrides.role];
    }
  }
  // Custom WorkOS claims (organization_id, roles, etc.) are not part
  // of Convex's typed UserIdentity but pass through convex-test's
  // withIdentity at runtime, where ctx.auth.getUserIdentity() exposes
  // them via index access. Cast to satisfy the Partial<UserIdentity>
  // parameter type.
  return id as any;
}

describe("Authorization helpers", () => {
  test("requireAuthenticatedUser rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Auth Club",
        slug: "auth-club",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_auth",
        status: "active",
        contactEmail: "gm@auth.com",
        createdAt: Date.now(),
      })
    );
    await expect(
      t.query(internal.authzProbe.requireAuthenticatedUserProbe, { tenantId: tenantId as any })
    ).rejects.toThrow("UNAUTHENTICATED");
  });

  test("requireTenantMembership accepts an authenticated active member", async () => {
    const t = convexTest(schema, modules);
    const { tenantId, userId } = await seedTenantAndUser(t, "member");

    await t.run(async (ctx) =>
      ctx.db.insert("tenantMemberships", {
        tenantId: tenantId as any,
        userId: userId as any,
        role: "player",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const authed = t.withIdentity(workosIdentityFor("member"));
    const ok = await authed.query(internal.authzProbe.requireTenantMembershipProbe, {
      tenantId: tenantId as any,
    });
    expect(ok).toMatchObject({ role: "player", status: "active" });
  });

  test("requireTenantMembership rejects when caller has no membership row", async () => {
    const t = convexTest(schema, modules);
    const { tenantId } = await seedTenantAndUser(t, "stranger");
    const authed = t.withIdentity(workosIdentityFor("stranger"));
    await expect(
      authed.query(internal.authzProbe.requireTenantMembershipProbe, { tenantId: tenantId as any })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireTenantMembership rejects suspended members with MEMBERSHIP_SUSPENDED", async () => {
    const t = convexTest(schema, modules);
    const { tenantId, userId } = await seedTenantAndUser(t, "suspended");
    await t.run(async (ctx) =>
      ctx.db.insert("tenantMemberships", {
        tenantId: tenantId as any,
        userId: userId as any,
        role: "player",
        status: "suspended",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    const authed = t.withIdentity(workosIdentityFor("suspended"));
    await expect(
      authed.query(internal.authzProbe.requireTenantMembershipProbe, { tenantId: tenantId as any })
    ).rejects.toThrow("MEMBERSHIP_SUSPENDED");
  });

  test("requireRole allows owner and game_master but rejects player", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-r1");
    const gm = await seedTenantAndUser(t, "gm-r1");
    const player = await seedTenantAndUser(t, "player-x-r1");
    await insertMembership(t, owner, "owner");
    await insertMembership(t, gm, "game_master");
    await insertMembership(t, player, "player");

    const ownerAuth = t.withIdentity(workosIdentityFor("owner-r1", { role: "owner" }));
    const gmAuth = t.withIdentity(workosIdentityFor("gm-r1", { role: "game_master" }));
    const playerAuth = t.withIdentity(workosIdentityFor("player-x-r1", { role: "player" }));

    await expect(
      ownerAuth.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner", "game_master"],
      })
    ).resolves.toMatchObject({ role: "owner" });

    await expect(
      gmAuth.query(internal.authzProbe.requireRoleProbe, {
        tenantId: gm.tenantId as any,
        allowedRoles: ["owner", "game_master"],
      })
    ).resolves.toMatchObject({ role: "game_master" });

    await expect(
      playerAuth.query(internal.authzProbe.requireRoleProbe, {
        tenantId: player.tenantId as any,
        allowedRoles: ["owner", "game_master"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireOwner rejects Game Master with FORBIDDEN", async () => {
    const t = convexTest(schema, modules);
    const gm = await seedTenantAndUser(t, "gm2-r1");
    await insertMembership(t, gm, "game_master");
    const authed = t.withIdentity(workosIdentityFor("gm2-r1", { role: "game_master" }));
    await expect(
      authed.query(internal.authzProbe.requireOwnerProbe, { tenantId: gm.tenantId as any })
    ).rejects.toThrow("FORBIDDEN");
  });

  // --- Trusted WorkOS claim coverage ---------------------------------------

  test("requireRole accepts owner when JWT organization_id and roles match", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-w1");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      workosIdentityFor("owner-w1", {
        organization_id: "org_owner-w1",
        organization_membership_id: "wos_owner-w1_owner",
        role: "owner",
      })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).resolves.toMatchObject({ role: "owner" });
  });

  test("requireRole rejects owner when WorkOS organization_id claim is wrong", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-w2");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      workosIdentityFor("owner-w2", {
        organization_id: "org_someone-else",
        organization_membership_id: "wos_owner-w2_owner",
        role: "owner",
      })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireRole rejects owner when JWT role claim does not include owner", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-w4");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      workosIdentityFor("owner-w4", {
        organization_id: "org_owner-w4",
        organization_membership_id: "wos_owner-w4_owner",
        // WorkOS revoked the admin role.
        role: "player",
      })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireRole rejects when JWT issuer is not WorkOS", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-w5");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      workosIdentityFor("owner-w5", {
        issuer: "https://evil.example.com",
        role: "owner",
      })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireRole rejects owner when local membership has no WorkOS linkage", async () => {
    const t = convexTest(schema, modules);
    const ghost = await seedTenantAndUser(t, "ghost-w6");
    await t.run(async (c) =>
      c.db.insert("tenantMemberships", {
        tenantId: ghost.tenantId as any,
        userId: ghost.userId as any,
        role: "owner",
        status: "active",
        // intentionally no workosOrganizationMembershipId
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    const authed = t.withIdentity(
      workosIdentityFor("ghost-w6", {
        organization_id: "org_ghost-w6",
        organization_membership_id: "wos_ghost-w6_owner",
        role: "owner",
      })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: ghost.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  // --- Bypass coverage: missing claims must not skip the check -----------

  test("requireRole rejects owner when JWT is a personal-account session with no organization_id claim", async () => {
    // Regression: previously `if (claimOrgId && ...)` silently skipped
    // the org check when no organization_id was present. A stale
    // local owner projection + a personal-account JWT must not grant
    // admin authority.
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-b1");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      workosIdentityFor("owner-b1", { noClaims: true })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireRole rejects owner when JWT has organization_id + membership id but no roles claim", async () => {
    // WorkOS admin sessions always carry roles; absence means the
    // caller is a non-admin org member attempting to act as owner.
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-b3");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity({
      tokenIdentifier: "https://api.workos.com|owner-b3",
      subject: "owner-b3",
      issuer: "https://api.workos.com",
      name: "owner-b3",
      email: "owner-b3@example.com",
      // organization_id + organization_membership_id present, but no roles claim
      organization_id: "org_owner-b3",
      organization_membership_id: `wos_owner-b3_owner`,
    } as any);
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireRole accepts when JWT carries multiple roles and the membership role is one of them", async () => {
    const t = convexTest(schema, modules);
    const gm = await seedTenantAndUser(t, "gm-w7");
    await insertMembership(t, gm, "game_master");
    const authed = t.withIdentity(
      workosIdentityFor("gm-w7", {
        organization_id: "org_gm-w7",
        organization_membership_id: "wos_gm-w7_game_master",
        role: ["player", "game_master"],
      })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: gm.tenantId as any,
        allowedRoles: ["owner", "game_master"],
      })
    ).resolves.toMatchObject({ role: "game_master" });
  });

  // --- Other helpers ------------------------------------------------------

  test("requirePlayerProfile rejects users without a tenant player profile", async () => {
    const t = convexTest(schema, modules);
    const fresh = await seedTenantAndUser(t, "no-profile");
    await insertMembership(t, fresh, "player");
    const authed = t.withIdentity(workosIdentityFor("no-profile"));
    await expect(
      authed.query(internal.authzProbe.requirePlayerProfileProbe, {
        tenantId: fresh.tenantId as any,
      })
    ).rejects.toThrow("PROFILE_REQUIRED");
  });

  test("requireOwnPlayer rejects when player row is missing", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner3");
    await insertMembership(t, owner, "owner");
    // Create a player row and then immediately delete it so we have a
    // syntactically-valid Convex id that no longer resolves to a doc.
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        tenantId: owner.tenantId as any,
        firstName: "Ghost",
        lastName: "Player",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        createdAt: Date.now(),
      })
    );
    await t.run(async (ctx) => ctx.db.delete(playerId));
    const authed = t.withIdentity(workosIdentityFor("owner3", { role: "owner" }));
    await expect(
      authed.query(internal.authzProbe.requireOwnPlayerProbe, {
        playerId: playerId as any,
      })
    ).rejects.toThrow("RESOURCE_NOT_FOUND");
  });

  test("requireOwnPlayer rejects when admin does not have membership in the player's tenant", async () => {
    const t = convexTest(schema, modules);
    // Owner only has membership in tenant A.
    const owner = await seedTenantAndUser(t, "owner4");
    await insertMembership(t, owner, "owner");
    // Player is in tenant B (different organization).
    const otherTenant = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Other Tenant",
        slug: "other-tenant-1",
        timezone: "Asia/Manila",
        workosOrganizationId: "org_other-tenant-1",
        status: "active",
        contactEmail: "other@x.com",
        createdAt: Date.now(),
      })
    );
    const playerInOther = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        tenantId: otherTenant as any,
        firstName: "Other",
        lastName: "Player",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        createdAt: Date.now(),
      })
    );
    const authed = t.withIdentity(workosIdentityFor("owner4", { role: "owner" }));
    await expect(
      authed.query(internal.authzProbe.requireOwnPlayerProbe, {
        playerId: playerInOther as any,
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireOwnPlayer rejects player-role callers (fail closed until Task 4.1)", async () => {
    const t = convexTest(schema, modules);
    const player = await seedTenantAndUser(t, "player5");
    await insertMembership(t, player, "player");
    const playerRow = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        tenantId: player.tenantId as any,
        firstName: "Self",
        lastName: "Player",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        createdAt: Date.now(),
      })
    );
    const authed = t.withIdentity(workosIdentityFor("player5", { role: "player" }));
    await expect(
      authed.query(internal.authzProbe.requireOwnPlayerProbe, {
        playerId: playerRow as any,
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  // --- Phase 1 admin-claim regression coverage -----------------------------
  //
  // Standard WorkOS AuthKit access tokens do not carry an
  // `organization_membership_id` claim. The local
  // `tenantMemberships.workosOrganizationMembershipId` is a separate
  // projection maintained by reconciliation/webhooks. Admin helpers
  // must validate the trusted org + role claims automatically whenever
  // the local membership is owner or game_master; there is no longer a
  // caller-controlled opt-out.

  /** Build an AuthKit-shaped token: only `org_id` + `role`. */
  function authkitToken(
    subjectTag: string,
    overrides: {
      organization_id?: string;
      role?: string | string[];
      issuer?: string;
    } = {}
  ): any {
    const tokenIdentifier = `https://api.workos.com|${subjectTag}`;
    const id: Record<string, unknown> = {
      tokenIdentifier,
      subject: subjectTag,
      issuer: overrides.issuer ?? "https://api.workos.com",
      name: subjectTag,
      email: `${subjectTag}@example.com`,
    };
    if (overrides.organization_id !== undefined) {
      id["org_id"] = overrides.organization_id;
    }
    if (overrides.role !== undefined) {
      id["role"] = Array.isArray(overrides.role)
        ? overrides.role
        : overrides.role;
    }
    return id as any;
  }

  test("requireRole: standard valid token containing only org_id and role succeeds", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-s1");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      authkitToken("owner-s1", { organization_id: "org_owner-s1", role: "owner" })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).resolves.toMatchObject({ role: "owner" });
  });

  test("requireRole: missing org_id is rejected with FORBIDDEN", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-m1");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      authkitToken("owner-m1", { role: "owner" })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireRole: missing role is rejected with FORBIDDEN", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-m2");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      authkitToken("owner-m2", { organization_id: "org_owner-m2" })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireRole: wrong organization is rejected with FORBIDDEN", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-wr1");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      authkitToken("owner-wr1", {
        organization_id: "org_someone-else",
        role: "owner",
      })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireRole: wrong role is rejected with FORBIDDEN", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-wr2");
    await insertMembership(t, owner, "owner");
    const authed = t.withIdentity(
      authkitToken("owner-wr2", {
        organization_id: "org_owner-wr2",
        role: "player",
      })
    );
    await expect(
      authed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: owner.tenantId as any,
        allowedRoles: ["owner"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireRole: validates trusted WorkOS claims without special options", async () => {
    // Regression: the old `requireTrustedWorkOSClaim: true` opt-in is
    // gone. The helper must auto-validate for admin roles when no
    // options object is passed at all.
    const t = convexTest(schema, modules);
    const gm = await seedTenantAndUser(t, "gm-auto");
    await insertMembership(t, gm, "game_master");
    const validAuthed = t.withIdentity(
      authkitToken("gm-auto", {
        organization_id: "org_gm-auto",
        role: "game_master",
      })
    );
    await expect(
      validAuthed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: gm.tenantId as any,
        allowedRoles: ["owner", "game_master"],
      })
    ).resolves.toMatchObject({ role: "game_master" });

    const invalidAuthed = t.withIdentity(
      authkitToken("gm-auto", {
        organization_id: "org_gm-auto",
        role: "player",
      })
    );
    await expect(
      invalidAuthed.query(internal.authzProbe.requireRoleProbe, {
        tenantId: gm.tenantId as any,
        allowedRoles: ["owner", "game_master"],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireOwnPlayer: enforces admin claim validation (rejects missing org_id)", async () => {
    // Regression: a caller of requireOwnPlayer used to be able to
    // pass `{ requireTrustedWorkOSClaim: false }` to skip the check.
    // The new contract is unconditional validation for owner/GM.
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-rop");
    await insertMembership(t, owner, "owner");
    const playerRow = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        tenantId: owner.tenantId as any,
        firstName: "Subject",
        lastName: "Player",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        createdAt: Date.now(),
      })
    );

    // Token with no org_id must be rejected even though the caller
    // has a local owner membership.
    const authed = t.withIdentity(authkitToken("owner-rop", { role: "owner" }));
    await expect(
      authed.query(internal.authzProbe.requireOwnPlayerProbe, {
        playerId: playerRow as any,
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  test("requireOwnPlayer: standard valid token succeeds", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedTenantAndUser(t, "owner-rop-ok");
    await insertMembership(t, owner, "owner");
    const playerRow = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        tenantId: owner.tenantId as any,
        firstName: "Subject",
        lastName: "Player",
        skillSource: "manual",
        manualSkillLevel: "Novice",
        createdAt: Date.now(),
      })
    );
    const authed = t.withIdentity(
      authkitToken("owner-rop-ok", {
        organization_id: "org_owner-rop-ok",
        role: "owner",
      })
    );
    await expect(
      authed.query(internal.authzProbe.requireOwnPlayerProbe, {
        playerId: playerRow as any,
      })
    ).resolves.toMatchObject({ tenantId: owner.tenantId });
  });
});

// ---- helpers used only by these tests ----
async function seedTenantAndUser(
  t: ReturnType<typeof convexTest>,
  subjectTag: string
): Promise<{ tenantId: any; userId: any }> {
  const tokenIdentifier = `https://api.workos.com|${subjectTag}`;
  const tenantId = await t.run(async (ctx) =>
    ctx.db.insert("tenants", {
      name: `Tenant ${subjectTag}`,
      slug: `tenant-${subjectTag}`,
      timezone: "Asia/Manila",
      workosOrganizationId: `org_${subjectTag}`,
      status: "active",
      contactEmail: `${subjectTag}@example.com`,
      createdAt: Date.now(),
    })
  );
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      tokenIdentifier,
      workosUserId: subjectTag,
      email: `${subjectTag}@example.com`,
      emailNormalized: `${subjectTag}@example.com`,
      tenantId: tenantId as any,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    })
  );
  return { tenantId, userId };
}

async function insertMembership(
  t: ReturnType<typeof convexTest>,
  ctx: { tenantId: any; userId: any },
  role: "owner" | "game_master" | "player"
) {
  // The membership id is derived from the userId. We need to look up
  // the user's `subjectTag` so we can use the same string in the
  // identity's `organization_membership_id` claim; we encode the
  // tag in the membership row for the test to read it back.
  // For tests we look up the user to find the tokenIdentifier suffix.
  const user = await t.run(async (c) => c.db.get(ctx.userId));
  const tokenIdentifier = user?.tokenIdentifier as string | undefined;
  const tag = tokenIdentifier?.split("|").pop() ?? "unknown";
  await t.run(async (c) =>
    c.db.insert("tenantMemberships", {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      role,
      status: "active",
      workosOrganizationMembershipId: `wos_${tag}_${role}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
}