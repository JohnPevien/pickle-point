---
title: Single-Tenant Authentication and Open Play Implementation Plan
---

# Single-Tenant Authentication and Open Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace self-created workspaces and accountless participation with a secure fixed-tenant MVP that supports WorkOS owner/Game Master access, verified player accounts, RSVP/Game Master check-in, event-only walk-ins, public realtime queue/live/leaderboard pages, and a future multi-tenant upgrade path.

**Architecture:** WorkOS remains authoritative for identity, verified email, seven-day sessions, the administrative organization, invitations, and administrative roles. Convex stores the fixed tenant, local membership projection, account-backed player profiles, authorization, open-play participation, queues, matches, scores, statistics, audit records, and idempotent WorkOS webhook receipts. All schema changes use widen-migrate-narrow and every public Convex function receives an explicit access class.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Convex 1.39, WorkOS AuthKit, WorkOS Node SDK, Vitest with `convex-test`, Tailwind CSS 4, pnpm.

---

## Source documents and worker rules

- Design specification: `docs/superpowers/specs/2026-06-29-single-tenant-auth-player-open-play-design.md`
- Progress tracker: `docs/superpowers/plans/2026-06-29-single-tenant-auth-open-play-tracker.html`
- Before every Convex task, read `convex/_generated/ai/guidelines.md` completely.
- Start execution from a clean worktree created with `superpowers:using-git-worktrees`.
- Do not combine tasks that modify the same primary file in parallel.
- Follow red-green-refactor. Run the named focused test before and after implementation.
- Update the HTML tracker with branch, owner, evidence, and status at each task handoff.
- Commit only the files listed for the task unless the task explicitly expands scope.
- Keep generated Convex files in the same commit as the schema/function change that generated them.

## Phase and dependency map

| Phase | Outcome | Depends on | Parallelism |
|---|---|---|---|
| 0. Baseline | Clean, reviewed starting point and access inventory | None | Sequential |
| 1. Tenancy foundation | Widened schema, membership model, auth helpers, fixed tenant | Phase 0 | Tasks 1.2–1.3 sequential after 1.1 |
| 2. WorkOS lifecycle | Login reconciliation, webhook sync, seven-day sessions, no public setup | Phase 1 | 2.1 then 2.2/2.3 |
| 3. Backend authorization | Every current Convex function classified and protected | Phases 1–2 | Domain tasks may run in isolated worktrees |
| 4. Player workspace | Slug home, verified player provisioning, profile, dashboard | Phases 1–3 core helpers | UI tasks parallel after backend APIs |
| 5. Participation lifecycle | Scheduled events, RSVP, GM check-in, walk-ins, no-shows | Phases 3–4 | Sequential around schema migrations |
| 6. Live operations | Courts, doubles matches, filler, scores, public queue/leaderboard | Phase 5 | Public UI after APIs |
| 7. Rollout | Production backfill, compatibility switch, cleanup, full verification | Phases 1–6 | Sequential deployment gates |

## Phase 0: Establish the execution baseline

### Task 0.1: Preserve and review the current uncommitted auth/dev changes

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `README.md`
- Modify: `src/lib/auth/server.ts`
- Modify: `src/app/sign-in/route.ts`
- Modify: `src/app/setup/page.tsx`
- Modify: `src/app/[tenant]/admin/layout.tsx`
- Modify: `src/app/[tenant]/admin/workspace/page.tsx`
- Modify: `src/app/docs/layout.tsx`
- Test: `src/lib/auth/workos-routes.test.ts`

- [ ] **Step 1: Inspect the baseline diff**

Run: `git status --short && git diff --check && git diff --stat`

Expected: only the already-developed unified dev command, AuthKit 4.1.3 update, cookie-safe sign-in redirect, README, and test changes are present.

- [ ] **Step 2: Run the focused auth regression**

Run: `pnpm test src/lib/auth/workos-routes.test.ts`

Expected: 20 tests pass, including unauthenticated `/setup` redirect and safe `returnTo` handling.

- [ ] **Step 3: Run the baseline gate**

Run: `pnpm test && pnpm lint && pnpm build`

Expected: all commands exit 0.

- [ ] **Step 4: Commit the baseline**

```bash
git add README.md package.json pnpm-lock.yaml src/lib/auth/server.ts src/app/sign-in/route.ts src/app/setup/page.tsx src/app/[tenant]/admin/layout.tsx src/app/[tenant]/admin/workspace/page.tsx src/app/docs/layout.tsx src/lib/auth/workos-routes.test.ts docs/superpowers/specs/2026-06-27-unified-dev-command-design.md
git commit -m "fix: coordinate local dev and cookie-safe auth redirects"
```

### Task 0.2: Create the function access inventory

**Files:**
- Create: `docs/security/convex-access-matrix.md`
- Read: `convex/*.ts`

- [ ] **Step 1: List every registered function**

Run: `rg -n '^export const .* = (query|mutation|action|internalQuery|internalMutation|internalAction)' convex --glob '*.ts' --glob '!*.test.ts' --glob '!_generated/**'`

Expected: the inventory includes tenants, users, venues, players, stats, tournaments, and open play.

- [ ] **Step 2: Write the matrix**

Use exactly these access labels: `public_read`, `player`, `game_master`, `owner`, `internal`. For each function record current arguments, resource-derived tenant path, intended helper, private fields returned, and the Phase 3 task that will harden it.

- [ ] **Step 3: Verify complete coverage**

Run a small Node script that extracts exported registered function names and fails when a name is absent from `docs/security/convex-access-matrix.md`.

Expected: exit 0 and no unclassified function names.

- [ ] **Step 4: Commit**

```bash
git add docs/security/convex-access-matrix.md
git commit -m "docs: inventory Convex access boundaries"
```

## Phase 1: Build the tenancy and authorization foundation

### Task 1.1: Widen the tenant, user, membership, audit, and webhook schema

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/schema.contract.test.ts`
- Regenerate: `convex/_generated/*`

- [ ] **Step 1: Write a failing schema contract test**

The test must create a tenant with `slug`, `timezone`, `workosOrganizationId`, and `status`; a global user; one membership; one audit record; and one webhook receipt. Assert the compound membership lookup returns exactly one row.

```ts
expect(membership).toMatchObject({
  role: "owner",
  status: "active",
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm test convex/schema.contract.test.ts`

Expected: FAIL because the new tables/fields do not exist.

- [ ] **Step 3: Add the widened schema**

Add optional migration-safe tenant/user fields and new `tenantMemberships`, `auditLogs`, and `workosWebhookReceipts` tables with the exact fields and index names from the design specification. Keep `users.tenantId` and current player/session fields during widening.

- [ ] **Step 4: Generate and verify green**

Run: `pnpm exec convex codegen && pnpm test convex/schema.contract.test.ts`

Expected: generated types succeed and the focused test passes.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/schema.contract.test.ts convex/_generated
git commit -m "feat: widen schema for tenant memberships"
```

### Task 1.2: Add identity and role authorization helpers

**Files:**
- Create: `convex/lib/authz.ts`
- Create: `convex/lib/authz.test.ts`

- [ ] **Step 1: Write failing helper tests**

Cover unauthenticated, missing membership, suspended membership, player rejected from Game Master operation, Game Master accepted, owner accepted, and wrong WorkOS organization claim denied.

```ts
await expect(requireRole(ctx, tenantId, ["owner", "game_master"]))
  .rejects.toThrow("FORBIDDEN");
```

- [ ] **Step 2: Verify red**

Run: `pnpm test convex/lib/authz.test.ts`

Expected: FAIL because `convex/lib/authz.ts` is missing.

- [ ] **Step 3: Implement the helper API**

Export typed helpers named `requireAuthenticatedUser`, `requireTenantMembership`, `requireRole`, `requireOwner`, `requirePlayerProfile`, `requireOwnPlayer`, and `requireOwnParticipation`. Resolve users only through `identity.tokenIdentifier`. Administrative roles must also validate current trusted WorkOS organization/role claims.

- [ ] **Step 4: Verify green**

Run: `pnpm test convex/lib/authz.test.ts`

Expected: all helper cases pass.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/authz.ts convex/lib/authz.test.ts
git commit -m "feat: centralize tenant authorization"
```

### Task 1.3: Add idempotent user and membership reconciliation

**Files:**
- Modify: `convex/users.ts`
- Modify: `convex/users.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Test first login creates one user/membership, replay updates `lastSeenAt`, a role downgrade updates membership, a second tenant creates a second membership without duplicating the user, and conflicting token/email data does not merge identities.

- [ ] **Step 2: Verify red**

Run: `pnpm test convex/users.test.ts`

Expected: new tests fail because reconciliation APIs do not exist.

- [ ] **Step 3: Implement internal reconciliation**

Add an internal mutation accepting trusted normalized WorkOS claims and resolved tenant ID. It upserts by `tokenIdentifier`, then upserts the `by_tenantId_and_userId` membership. It never accepts role data from a browser-callable public mutation.

- [ ] **Step 4: Verify green**

Run: `pnpm test convex/users.test.ts`

Expected: all user tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/users.ts convex/users.test.ts
git commit -m "feat: reconcile WorkOS users and memberships"
```

### Task 1.4: Add fixed-tenant bootstrap and slug resolution

**Files:**
- Modify: `convex/tenants.ts`
- Modify: `convex/tenants.test.ts`

- [ ] **Step 1: Write failing tests**

Test `getPublicBySlug`, duplicate-slug rejection, duplicate WorkOS organization rejection, idempotent bootstrap, disabled tenant hidden from public lookup, and explicit canonical tenant selection.

- [ ] **Step 2: Verify red**

Run: `pnpm test convex/tenants.test.ts`

Expected: new tests fail.

- [ ] **Step 3: Implement internal bootstrap and safe public projection**

The internal bootstrap takes exact tenant configuration and returns the existing row when slug and organization match. `getPublicBySlug` returns only branding, slug, timezone, and safe contact information.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm test convex/tenants.test.ts`

```bash
git add convex/tenants.ts convex/tenants.test.ts
git commit -m "feat: bootstrap fixed tenant by slug"
```

### Task 1.5: Backfill current users into memberships

**Files:**
- Create: `convex/migrations/usersToMemberships.ts`
- Create: `convex/migrations/usersToMemberships.test.ts`

- [ ] **Step 1: Write failing migration fixture tests**

Fixtures must include configured owner, approved Game Master, unclassified user, missing tenant, and rerun. Assert owner/Game Master roles, suspended fallback, bounded continuation, and zero duplicates.

- [ ] **Step 2: Verify red**

Run: `pnpm test convex/migrations/usersToMemberships.test.ts`

- [ ] **Step 3: Implement a bounded internal migration**

Process a fixed batch with `.take(batchSize)`, write idempotently through the compound index, and schedule continuation with `ctx.scheduler.runAfter(0, ...)`. Inputs include canonical tenant ID, normalized owner email, and approved Game Master emails.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm test convex/migrations/usersToMemberships.test.ts`

```bash
git add convex/migrations/usersToMemberships.ts convex/migrations/usersToMemberships.test.ts
git commit -m "feat: migrate users to tenant memberships"
```

## Phase 2: Integrate the WorkOS administrative lifecycle

### Task 2.1: Add direct WorkOS SDK and webhook configuration

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `convex.json`
- Modify: `README.md`

- [ ] **Step 1: Add the direct dependency**

Run: `pnpm add @workos-inc/node@^9.0.0`

Expected: package and lockfile list a direct WorkOS Node dependency.

- [ ] **Step 2: Document required secrets**

Document `WORKOS_WEBHOOK_SECRET`, `WORKOS_COOKIE_MAX_AGE=604800`, canonical tenant slug/timezone, and WorkOS organization ID. Do not commit secret values.

- [ ] **Step 3: Verify package graph**

Run: `pnpm why @workos-inc/node && pnpm lint`

Expected: dependency resolves and lint exits 0.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml convex.json README.md
git commit -m "chore: configure WorkOS membership synchronization"
```

### Task 2.2: Verify and ingest WorkOS webhooks

**Files:**
- Create: `convex/workosActions.ts`
- Create: `convex/workosSync.ts`
- Create: `convex/http.ts`
- Create: `convex/workosSync.test.ts`

- [ ] **Step 1: Write failing tests**

Cover valid membership-created/updated/deleted events, invalid signature, wrong organization, duplicate event ID, unsupported event type, and retry after failed processing.

- [ ] **Step 2: Verify red**

Run: `pnpm test convex/workosSync.test.ts`

- [ ] **Step 3: Implement verification and application boundaries**

`workosActions.ts` uses `"use node"` and only verifies/parses signatures. `http.ts` registers `/workos/webhooks`. `workosSync.ts` applies validated events through internal mutations and writes a receipt before returning success. Duplicate receipts return 200 without applying twice.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm test convex/workosSync.test.ts`

```bash
git add convex/workosActions.ts convex/workosSync.ts convex/http.ts convex/workosSync.test.ts
git commit -m "feat: synchronize WorkOS organization memberships"
```

### Task 2.3: Reconcile membership on callback/login

**Files:**
- Modify: `src/app/callback/route.ts`
- Create: `src/lib/auth/reconcile.ts`
- Modify: `src/lib/auth/workos-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Test owner/Game Master claims call reconciliation, ordinary player login does not invent an admin role, replay is idempotent, and reconciliation failure routes to a safe support page without leaking claims.

- [ ] **Step 2: Verify red**

Run: `pnpm test src/lib/auth/workos-routes.test.ts`

- [ ] **Step 3: Implement callback success reconciliation**

Wrap `handleAuth` with its supported success callback. Pass only trusted server-side claim data to a server reconciliation helper. Preserve PKCE handling and return path.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm test src/lib/auth/workos-routes.test.ts`

```bash
git add src/app/callback/route.ts src/lib/auth/reconcile.ts src/lib/auth/workos-routes.test.ts
git commit -m "feat: reconcile WorkOS roles after login"
```

### Task 2.4: Remove public workspace creation

**Files:**
- Delete: `src/app/setup/page.tsx`
- Delete or repurpose: `src/components/setup/WorkspaceSetupForm.tsx`
- Modify: `src/lib/home/actions.ts`
- Modify: `src/lib/home/actions.test.ts`
- Modify: `convex/tenants.ts`
- Modify: `convex/tenants.test.ts`

- [ ] **Step 1: Write failing tests**

Assert home contains workspace Sign in/Register rather than Create workspace, `/setup` is absent or redirects to the fixed slug, and no public `createWorkspace` function remains callable.

- [ ] **Step 2: Verify red**

Run: `pnpm test src/lib/home/actions.test.ts convex/tenants.test.ts`

- [ ] **Step 3: Remove the self-service creation path**

Keep workspace editing as an owner-only operation. Tenant creation remains internal bootstrap only.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test src/lib/home/actions.test.ts convex/tenants.test.ts && pnpm build`

```bash
git add -A src/app/setup src/components/setup src/lib/home convex/tenants.ts convex/tenants.test.ts
git commit -m "fix: remove self-service workspace creation"
```

## Phase 3: Harden every Convex domain

### Task 3.1: Protect tenant and venue functions

**Files:**
- Modify: `convex/tenants.ts`
- Modify: `convex/tenants.test.ts`
- Modify: `convex/venues.ts`
- Modify: `convex/venues.test.ts`

- [ ] Write failing tests for public tenant projection, owner-only settings, Game Master venue CRUD, player rejection, and cross-tenant IDs.
- [ ] Run `pnpm test convex/tenants.test.ts convex/venues.test.ts` and confirm the new cases fail.
- [ ] Use resource-derived tenant checks and remove access decisions based only on browser-provided tenant IDs.
- [ ] Re-run the focused tests and confirm pass.
- [ ] Commit with `git commit -m "fix: enforce tenant and venue authorization"`.

### Task 3.2: Protect player and statistics functions

**Files:**
- Modify: `convex/players.ts`
- Modify: `convex/players.test.ts`
- Modify: `convex/stats.ts`
- Modify: `convex/stats.test.ts`

- [ ] Write failing cases for own-profile safe edits, another-player denial, Game Master corrections, identity-link immutability, safe public event stats, and hidden contacts.
- [ ] Run `pnpm test convex/players.test.ts convex/stats.test.ts` and confirm failure.
- [ ] Split safe public projections from administrative/player-private queries and invoke central helpers in every mutation.
- [ ] Re-run focused tests and confirm pass.
- [ ] Commit with `git commit -m "fix: enforce player and stats authorization"`.

### Task 3.3: Protect open-play reads and administrative lifecycle

**Files:**
- Modify: `convex/openPlaySessions.ts`
- Modify: `convex/openPlaySessions.test.ts`

- [ ] Add failing tests for safe public reads, private RSVP omission, player event visibility, Game Master create/status/mode access, and cross-tenant denial.
- [ ] Run `pnpm test convex/openPlaySessions.test.ts` and confirm new failures.
- [ ] Add explicit public projection functions and role checks for administrative lifecycle mutations.
- [ ] Re-run the focused suite and confirm pass.
- [ ] Commit with `git commit -m "fix: authorize open-play lifecycle functions"`.

### Task 3.4: Protect open-play queue, match, and score mutations

**Files:**
- Modify: `convex/openPlaySessions.ts`
- Modify: `convex/openPlaySessions.test.ts`

- [ ] Add failing tests proving players cannot check in, manipulate queues, generate matches, substitute, cancel, or score; Game Masters can; wrong-tenant resources fail.
- [ ] Run the focused suite and confirm red.
- [ ] Load the session/match first, derive tenant, then call `requireRole` before mutation.
- [ ] Re-run focused tests and confirm green.
- [ ] Commit with `git commit -m "fix: authorize open-play operations"`.

### Task 3.5: Protect tournament functions

**Files:**
- Modify: `convex/tournaments.ts`
- Modify: `convex/tournaments.test.ts`
- Modify: `convex/players.ts`
- Modify: `convex/players.test.ts`

- [ ] Add failing cases for safe public tournament view, registered-profile-only entry, owner/Game Master lifecycle/seed/bracket/score operations, and cross-tenant IDs.
- [ ] Run `pnpm test convex/tournaments.test.ts convex/players.test.ts` and confirm red.
- [ ] Apply resource-derived authorization and stop public tournament registration from creating accountless persistent players.
- [ ] Re-run focused tests and confirm green.
- [ ] Commit with `git commit -m "fix: authorize tournament operations"`.

### Task 3.6: Enforce access-matrix completeness in CI

**Files:**
- Create: `scripts/check-convex-access.mjs`
- Create then delete during red/green proof: `convex/accessMatrixFixture.ts`
- Modify: `package.json`
- Modify: `docs/security/convex-access-matrix.md`

- [ ] Write the script so an exported registered function missing from the matrix exits 1 and prints the exact name.
- [ ] Add an unclassified registered query in `convex/accessMatrixFixture.ts` and run `pnpm check:convex-access`; expect failure naming `accessMatrixFixture.unclassified`.
- [ ] Remove the fixture, classify all real functions, and add `check:convex-access` to the validation workflow.
- [ ] Run `pnpm check:convex-access`; expect exit 0.
- [ ] Commit with `git commit -m "test: enforce Convex access classification"`.

## Phase 4: Build the player workspace

### Task 4.1: Widen and backfill account-backed player profiles

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/migrations/playerProfiles.ts`
- Create: `convex/migrations/playerProfiles.test.ts`

- [ ] Write failing fixtures for account profile, legacy unclaimed profile, duplicate user/tenant rejection, rerun, and bounded continuation.
- [ ] Run `pnpm test convex/migrations/playerProfiles.test.ts`; expect red.
- [ ] Add optional `userId`, `profileKind`, `fullName`, `nickname`, timestamps, and required indexes; backfill existing records as `legacy_unclaimed` without linking.
- [ ] Run codegen and focused tests; expect green.
- [ ] Commit with `git commit -m "feat: add account-backed player profiles"`.

### Task 4.2: Provision player membership and profile idempotently

**Files:**
- Modify: `convex/players.ts`
- Modify: `convex/players.test.ts`

- [ ] Add failing tests for verified user joining by slug, one membership/profile per tenant, replay, missing full name/nickname, disabled tenant, and no automatic legacy match.
- [ ] Run focused tests and confirm red.
- [ ] Add authenticated `joinWorkspace` and `completeMyProfile` APIs that derive user from token and tenant from slug.
- [ ] Re-run focused tests and confirm green.
- [ ] Commit with `git commit -m "feat: provision tenant player profiles"`.

### Task 4.3: Convert tenant routing from raw ID to slug

**Files:**
- Modify: `src/app/[tenant]/layout.tsx`
- Modify: `src/app/[tenant]/register/page.tsx`
- Modify: `src/app/[tenant]/open-play/[sessionId]/page.tsx`
- Modify: `src/app/[tenant]/tournaments/[tournamentId]/page.tsx`
- Modify: `src/app/[tenant]/admin/layout.tsx`
- Modify: `src/app/[tenant]/admin/dashboard/page.tsx`
- Modify: `src/app/[tenant]/admin/open-play/page.tsx`
- Modify: `src/app/[tenant]/admin/players/page.tsx`
- Modify: `src/app/[tenant]/admin/tournaments/page.tsx`
- Modify: `src/app/[tenant]/admin/tournaments/[tournamentId]/page.tsx`
- Modify: `src/app/[tenant]/admin/venues/page.tsx`
- Modify: `src/app/[tenant]/admin/workspace/page.tsx`
- Modify: `src/lib/url.ts`
- Modify: `src/lib/open-play/helpers.test.ts`
- Modify: `src/lib/tournament/helpers.test.ts`
- Modify: `src/lib/auth/workos-routes.test.ts`

- [ ] Add failing route/helper tests expecting friendly slug URLs and server-side slug resolution.
- [ ] Run the focused helper/auth route tests and confirm red.
- [ ] Resolve tenant once in layout/server helpers, pass trusted ID to children, and keep public 404 behavior for unknown/disabled slugs.
- [ ] Re-run tests and build; expect green.
- [ ] Commit with `git commit -m "feat: route workspaces by tenant slug"`.

### Task 4.4: Build public tenant home and profile completion

**Files:**
- Create: `src/app/[tenant]/page.tsx`
- Create: `src/app/[tenant]/profile/page.tsx`
- Create: `src/components/player/PlayerProfileForm.tsx`
- Create: `src/lib/player/profile.test.ts`

- [ ] Write failing tests for required full name/nickname, safe trimming, duplicate nickname allowed, verified membership requirement, and public upcoming-event projection.
- [ ] Run focused tests and confirm red.
- [ ] Implement the public home and authenticated profile form with no contact-field exposure.
- [ ] Re-run tests, lint, and build.
- [ ] Commit with `git commit -m "feat: add workspace player onboarding"`.

### Task 4.5: Build the player dashboard

**Files:**
- Create: `src/app/[tenant]/dashboard/page.tsx`
- Create: `src/components/player/PlayerDashboard.tsx`
- Create: `src/lib/player/dashboard.test.ts`
- Modify: `convex/openPlaySessions.ts`

- [ ] Write failing tests for available events, joined events, participation state, personal history, and exclusion of walk-in-only history.
- [ ] Run focused tests and confirm red.
- [ ] Add bounded dashboard queries and render available/joined/history sections.
- [ ] Re-run tests, lint, and build.
- [ ] Commit with `git commit -m "feat: add player event dashboard"`.

### Task 4.6: Add collision-aware display names

**Files:**
- Create: `src/lib/player/display-name.ts`
- Create: `src/lib/player/display-name.test.ts`
- Modify: `src/components/admin/OpenPlayControlView.tsx`
- Modify: `src/components/admin/PlayerDirectoryAdminView.tsx`
- Modify: `src/components/admin/DashboardView.tsx`
- Modify: `src/components/open-play/LiveBracketView.tsx`

- [ ] Write failing cases for unique nickname, case-insensitive collision, three-way collision, whitespace normalization, and collision limited to the visible group.
- [ ] Run `pnpm test src/lib/player/display-name.test.ts`; expect red.
- [ ] Implement one bounded frequency map and return `Nickname (Full Name)` only for collisions.
- [ ] Run `pnpm test src/lib/player/display-name.test.ts src/lib/open-play/helpers.test.ts src/lib/admin/dashboard.test.ts`; expect green.
- [ ] Commit with `git commit -m "feat: disambiguate duplicate player nicknames"`.

## Phase 5: Add RSVP, attendance, and event participants

### Task 5.1: Widen open-play scheduling and court schema

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/openPlaySessions.ts`
- Modify: `convex/openPlaySessions.test.ts`

- [ ] Add failing tests for public slug uniqueness, UTC start/end, Asia/Manila snapshot, end after start, court count override, and draft-to-scheduled publication.
- [ ] Run the open-play suite; expect red.
- [ ] Add migration-safe fields/status and update create/edit APIs under Game Master authorization.
- [ ] Run codegen and focused tests; expect green.
- [ ] Commit with `git commit -m "feat: schedule open play with event courts"`.

### Task 5.2: Add session participants and legacy compatibility

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/sessionParticipants.ts`
- Create: `convex/sessionParticipants.test.ts`
- Create: `convex/migrations/sessionParticipants.ts`

- [ ] Write failing tests for registered-player and walk-in invariants, split state dimensions, snapshot fields, compound uniqueness, legacy conversion, and rerun.
- [ ] Run `pnpm test convex/sessionParticipants.test.ts`; expect red.
- [ ] Add the table, compatibility reads, and bounded legacy backfill while retaining old `sessionPlayers` reads during the phase.
- [ ] Run codegen and focused tests; expect green.
- [ ] Commit with `git commit -m "feat: add event participation records"`.

### Task 5.3: Add player RSVP and withdrawal

**Files:**
- Modify: `convex/sessionParticipants.ts`
- Modify: `convex/sessionParticipants.test.ts`
- Modify: `src/components/player/PlayerDashboard.tsx`

- [ ] Add failing cases for authenticated own RSVP, duplicate idempotency, late Join before end, rejection after effective end, withdraw before check-in, and rejection after check-in.
- [ ] Run focused tests; expect red.
- [ ] Implement `joinOpenPlay` and `withdrawFromOpenPlay` using server time, token-derived profile, and session-derived tenant.
- [ ] Re-run focused tests and player UI tests; expect green.
- [ ] Commit with `git commit -m "feat: add player open-play RSVP"`.

### Task 5.4: Add Game Master check-in and walk-ins

**Files:**
- Modify: `convex/sessionParticipants.ts`
- Modify: `convex/sessionParticipants.test.ts`
- Modify: `src/components/admin/OpenPlayControlView.tsx`

- [ ] Add failing tests for player self-check-in denial, Game Master late check-in, queue allocation, walk-in snapshot, no reusable player row, no contact data, and failed mutation preserving queue counters.
- [ ] Run focused tests; expect red.
- [ ] Implement authorized check-in and walk-in creation; a walk-in starts checked-in and queued.
- [ ] Re-run focused tests and lint; expect green.
- [ ] Commit with `git commit -m "feat: add Game Master attendance controls"`.

### Task 5.5: Finalize no-shows idempotently

**Files:**
- Modify: `convex/openPlaySessions.ts`
- Modify: `convex/sessionParticipants.ts`
- Modify: `convex/openPlaySessions.test.ts`

- [ ] Add failing tests for end-time finalization, early completion, cancellation, withdrawn preservation, checked-in preservation, stale reschedule job, and duplicate invocation.
- [ ] Run focused tests; expect red.
- [ ] Schedule an internal finalizer that re-reads status/end time and reschedules or exits safely when stale.
- [ ] Re-run focused tests; expect green.
- [ ] Commit with `git commit -m "feat: finalize open-play no-shows"`.

### Task 5.6: Widen match slots for participants and anonymous filler

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/openPlaySessions.ts`
- Modify: `convex/openPlaySessions.test.ts`
- Create: `convex/migrations/matchParticipants.ts`

- [ ] Add failing fixtures for four real participants, three real plus filler, fewer than three rejection, filler absent from participant table, and legacy player-ID match conversion.
- [ ] Run focused tests; expect red.
- [ ] Add the discriminated slot union and bounded compatibility migration; retain filler label in event results only.
- [ ] Run codegen and focused tests; expect green.
- [ ] Commit with `git commit -m "feat: support event participants in doubles matches"`.

## Phase 6: Complete live operations and public event pages

### Task 6.1: Make court allocation and match generation concurrency-safe

**Files:**
- Modify: `convex/openPlaySessions.ts`
- Modify: `convex/openPlaySessions.test.ts`

- [ ] Add failing cases for one active match per court, one participant per active match, seven players across two courts with one filler, court release, and concurrent generation retry.
- [ ] Run focused tests; expect red.
- [ ] Allocate courts and mark participant play state in one mutation transaction; never split reservation across calls.
- [ ] Re-run focused tests; expect green.
- [ ] Commit with `git commit -m "feat: harden open-play court allocation"`.

### Task 6.2: Add deterministic event statistics and scoring

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/openPlayStats.ts`
- Create: `convex/openPlayStats.test.ts`
- Modify: `convex/openPlaySessions.ts`

- [ ] Add failing tests for non-negative integers, tie rejection, winner/loser stats, points, filler exclusion, walk-in event stats, registered career eligibility, duplicate score rejection, and correction recalculation.
- [ ] Run `pnpm test convex/openPlayStats.test.ts`; expect red.
- [ ] Add event-stat rows and a deterministic recomputation helper invoked transactionally by score create/correct.
- [ ] Run focused and open-play suites; expect green.
- [ ] Commit with `git commit -m "feat: score open play and rank event players"`.

### Task 6.3: Audit corrections, substitutions, cancellation, and completion

**Files:**
- Modify: `convex/openPlaySessions.ts`
- Modify: `convex/openPlaySessions.test.ts`
- Create: `convex/audit.ts`
- Create: `convex/audit.test.ts`

- [ ] Add failing tests for actor/resource metadata, safe before/after payload, completion blocked by active matches, post-completion authorized correction, and filler-safe substitution.
- [ ] Run focused tests; expect red.
- [ ] Centralize audit writes and make completion/correction operations atomic.
- [ ] Re-run focused tests; expect green.
- [ ] Commit with `git commit -m "feat: audit open-play result changes"`.

### Task 6.4: Add safe public event projections

**Files:**
- Modify: `convex/openPlaySessions.ts`
- Modify: `convex/openPlayStats.ts`
- Create: `convex/publicOpenPlay.test.ts`

- [ ] Add failing privacy snapshots for overview, live matches, queue, and leaderboard; assert email, phone, notes, WorkOS IDs, pending RSVPs, and no-show identities are absent.
- [ ] Run `pnpm test convex/publicOpenPlay.test.ts`; expect red.
- [ ] Add bounded indexed public queries by tenant/event slug and collision-aware display payloads.
- [ ] Re-run privacy tests; expect green.
- [ ] Commit with `git commit -m "feat: expose safe public open-play state"`.

### Task 6.5: Build public live, queue, and leaderboard pages

**Files:**
- Create: `src/app/[tenant]/open-play/[eventSlug]/page.tsx`
- Create: `src/app/[tenant]/open-play/[eventSlug]/queue/page.tsx`
- Create: `src/app/[tenant]/open-play/[eventSlug]/leaderboard/page.tsx`
- Create: `src/components/open-play/PublicQueueView.tsx`
- Create: `src/components/open-play/EventLeaderboard.tsx`
- Modify: `src/components/open-play/LiveBracketView.tsx`
- Modify: `src/lib/open-play/helpers.ts`
- Modify: `src/lib/open-play/helpers.test.ts`

- [ ] Add failing component/helper tests for stable URLs, live court state, queue states, ranking order, collision display, walk-in inclusion, and filler exclusion.
- [ ] Run `pnpm test src/lib/open-play/helpers.test.ts src/lib/player/display-name.test.ts`; expect red before the new URL/view helpers exist.
- [ ] Implement realtime Convex subscriptions and share/QR URLs without private fields.
- [ ] Re-run tests, lint, and build; expect green.
- [ ] Commit with `git commit -m "feat: publish realtime open-play views"`.

### Task 6.6: Finalize registered-player career statistics

**Files:**
- Modify: `convex/stats.ts`
- Modify: `convex/stats.test.ts`
- Modify: `convex/openPlayStats.ts`

- [ ] Add failing tests for account-player career aggregation, walk-in exclusion, filler exclusion, completion idempotency, and correction propagation.
- [ ] Run focused stats tests; expect red.
- [ ] Finalize or recompute career stats from completed registered-player results only.
- [ ] Re-run focused tests; expect green.
- [ ] Commit with `git commit -m "feat: finalize persistent player statistics"`.

## Phase 7: Migrate, switch, and verify

### Task 7.1: Add canonical production migration configuration and audit

**Files:**
- Create: `convex/migrations/auditCanonicalTenant.ts`
- Create: `convex/migrations/auditCanonicalTenant.test.ts`
- Create: `docs/runbooks/tenant-auth-migration.md`

- [ ] Add failing fixtures for no tenant, one tenant, multiple tenants, missing owner email, noncanonical users/data, and disabled quarantine.
- [ ] Run focused migration tests; expect red.
- [ ] Implement read-only audit output that requires an explicit tenant ID and never selects `.first()` as canonical.
- [ ] Re-run tests; expect green.
- [ ] Commit with `git commit -m "chore: audit canonical tenant migration inputs"`.

### Task 7.2: Execute bounded backfills in a staging deployment

**Files:**
- Update: `docs/runbooks/tenant-auth-migration.md`
- Use: `convex/migrations/usersToMemberships.ts`
- Use: `convex/migrations/playerProfiles.ts`
- Use: `convex/migrations/sessionParticipants.ts`
- Use: `convex/migrations/matchParticipants.ts`

- [ ] Export or back up staging data before mutation.
- [ ] Run the canonical audit and record tenant, user, player, session, match, and history counts.
- [ ] Run membership, player, participant, and match backfills in dependency order.
- [ ] Re-run every migration and verify zero duplicate writes.
- [ ] Compare pre/post counts and sample historical event pages.
- [ ] Record command output and evidence in the HTML tracker.

### Task 7.3: Switch compatibility reads/writes and narrow later

**Files:**
- Modify: `convex/users.ts`
- Modify: `convex/players.ts`
- Modify: `convex/openPlaySessions.ts`
- Modify: `convex/sessionParticipants.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/users.test.ts`
- Modify: `convex/players.test.ts`
- Modify: `convex/openPlaySessions.test.ts`
- Modify: `convex/sessionParticipants.test.ts`
- Modify: `convex/migrations/usersToMemberships.test.ts`
- Modify: `convex/migrations/playerProfiles.test.ts`
- Modify: `convex/migrations/sessionParticipants.test.ts`
- Modify: `convex/migrations/matchParticipants.test.ts`

- [ ] Add failing tests that disable legacy fallback and exercise the complete app flow.
- [ ] Switch reads and writes to memberships, profiles, participants, and match slots.
- [ ] Run full tests/build and confirm no legacy read is required.
- [ ] Deploy and observe before removing old fields.
- [ ] In a separate follow-up commit/PR, narrow schema and remove dead compatibility code.

### Task 7.4: Run the final security and workflow gate

**Files:**
- Modify: `docs/runbooks/tenant-auth-migration.md`
- Modify: `docs/superpowers/plans/2026-06-29-single-tenant-auth-open-play-tracker.html`

- [ ] Run `pnpm check:convex-access && pnpm test && pnpm lint && pnpm build`.
- [ ] Validate owner login, Game Master invitation acceptance, Game Master revocation, player signup/profile/RSVP, Game Master check-in, late arrival, withdrawal, no-show, walk-in, three-player filler match, scoring, correction, completion, and public results.
- [ ] Use two browsers to confirm realtime queue/live/leaderboard updates.
- [ ] Inspect public network responses for forbidden private fields.
- [ ] Confirm a synthetic second tenant can be seeded and isolated without schema changes.
- [ ] Record exact evidence and obtain owner sign-off before production rollout.
- [ ] Commit final runbook evidence with `git commit -m "docs: record tenant auth rollout verification"`.

## Branch and review recommendation

Use one reviewable branch per numbered task for Phase 0–2, one branch per domain task in Phase 3, and one branch per numbered task in Phases 4–7. Tasks that share `convex/openPlaySessions.ts` must execute sequentially or be stacked; do not merge parallel edits to that file by hand.

Recommended review gates:

1. Schema/API contract review before UI work.
2. Security review after Phase 3.
3. Product-flow review after Phase 4.
4. Concurrency/data-integrity review after Phases 5–6.
5. Migration evidence review before Phase 7 production execution.

## Plan self-review

- Every design requirement maps to a phase/task.
- Fixed tenant bootstrap precedes player enrollment.
- WorkOS reconciliation precedes administrative authorization hardening.
- Domain authorization precedes new player/event mutations.
- Legacy records are preserved and never auto-linked.
- RSVP, attendance, and play state remain separate.
- Walk-ins remain event-only; anonymous fillers remain match-only.
- Public projections have dedicated privacy tests.
- Schema narrowing is separated from backfill and observation.
- No task authorizes implementation agents to create tenants publicly or trust a browser tenant ID.
