---
title: Convex Function Access Matrix
description: Phase 0 inventory of every registered Convex function, its current arguments, resource-derived tenant path, intended authorization helper, private fields it returns today, and the Phase 3 task that hardens it.
---

# Convex Function Access Matrix

Access labels (controlled vocabulary): `public_read`, `player`, `game_master`, `owner`, `internal`.

Generated from `convex/*.ts` (excluding `_generated/**` and `*.test.ts`). Coverage is enforced by `scripts/check-convex-access.mjs` (Task 3.6 wires it into CI as `pnpm check:convex-access`).

## Current state summary

The baseline has **no central authorization helpers**. Most tenant/resource-scoped
public functions trust a browser-supplied `tenantId` (or resource ID) and perform only a
loose `tenantId !== args.tenantId` mismatch check at best. Several functions
perform **no auth check at all** and return private fields (email, phone,
notes, WorkOS identity) to any caller. This matrix is the Phase 3 work list.

**Progress:** Task 3.1 has hardened the tenant and venue surfaces
(`tenants.getById` safe projection with active-tenant gate, `tenants.getCurrentWorkspace`
owner-only gate, `tenants.updateWorkspace` owner gate, and all four `venues.*` functions
with resource-derived tenant authority). The public tenant projection
(`getById`, `getPublicBySlug`) exposes branding only — no `contactEmail`,
`workosOrganizationId`, or `status`. Task 3.2 has hardened the player and
statistics surfaces: all six `players.*` functions (admin-only via
`requireRole`/`requireOwnPlayer`, with resource-derived tenant authority and
bounded reads; players fail closed with `FORBIDDEN` pending the Task 4.1
`players.userId` link) and `stats.getLeaderboard` (public projection with an
active-tenant gate, cross-tenant/missing-player exclusion, and a truncation
flag). Rows marked ✅ 3.1 / ✅ 3.2 are hardened; the remaining tables
(openPlaySessions, tournaments) and `players.registerTournamentTeam` are still
at the baseline until Tasks 3.3–3.5 land.

Notation:

- **Args** — validator argument shape (abbreviated).
- **Tenant path** — how the function's tenant should be derived server-side
  in Phase 3 (resource → `tenantId`, never a client `tenantId`).
- **Helper** — the `require*` helper from `convex/lib/authz.ts` (Task 1.2)
  that Phase 3 will invoke.
- **Private fields returned today** — fields in the current response that the
  design's public-data boundary forbids for `public_read` callers.
- **Phase 3 task** — the task that hardens this function.

## tenants.ts

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned today | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `tenants.getById` | query | `public_read` (hardened) | `tenantId: v.string()` | `tenantId` arg → `ctx.db.normalizeId` then `ctx.db.get`; returns safe projection only; disabled/non-active tenants resolve to `null` | n/a — public projection (`toPublicTenant`) | none (safe projection): `_id`, `slug`, `name`, `timezone`, optional `logoUrl`/`primaryColor`/`secondaryColor`. Omits `workosOrganizationId`, `status`, and `contactEmail` | ✅ 3.1 |
| `tenants.getCurrentWorkspace` | query | `owner` (hardened) | `{}` | `identity.tokenIdentifier` → user → `user.tenantId` | `requireOwner(ctx, user.tenantId)` (returns `null` only on `AppError`; unexpected errors propagate) | Returns full `{ user, tenant }` only to an active owner; powers the owner-only workspace-settings page | ✅ 3.1 |
| `tenants.updateWorkspace` | mutation | `owner` (hardened) | `tenantId: v.id("tenants")`, workspace fields | `args.tenantId` | `requireOwner(ctx, args.tenantId)` (validates identity + active membership + trusted WorkOS claims) | none — returns `{ success }` only | ✅ 3.1 |
| `tenants.seed` | internalMutation | `internal` | `name`, colors, `contactEmail` | n/a (dev seed) | internal only | n/a | — (internal, stays internal) |
| `tenants.getPublicBySlug` | query | `public_read` | `slug: v.string()` | `args.slug` → `by_slug` (returns `null` for non-`active`) | n/a (public projection via shared `toPublicTenant`) | none (safe projection): same fields as `getById` — `_id`, `slug`, `name`, `timezone`, optional `logoUrl`/`primaryColor`/`secondaryColor`. Omits `workosOrganizationId`, `status`, and `contactEmail` | — (safe by construction) |
| `tenants.bootstrapFixedTenant` | internalMutation | `internal` | `slug`, `name`, `contactEmail`, `timezone`, `workosOrganizationId`, optional colors/logo | Idempotent by (slug, workosOrganizationId); rejects mismatched re-point with `TENANT_MISMATCH` | n/a (operator invoked; not a user auth surface) | Creates/updates tenant; writes `auditLogs` row tagged `tenant.bootstrap` | — |

## users.ts

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned today | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `users.getCurrentUser` | query | `player` (intended) / **token-gated today, no membership check** | `{}` | `identity.tokenIdentifier` → `by_tokenIdentifier` | `requireAuthenticatedUser` then membership projection | Returns full user doc incl. `email`, `name`, `tokenIdentifier` | 3.1 (identity) / 1.3 (reconciliation) |
| `users.getOrCreateUser` | internalMutation | `internal` | `tokenIdentifier`, `email`, `name?`, `tenantId` | `args.tenantId` | internal only (called by trusted reconciliation, Task 1.3) | n/a — internal |
| `users.reconcileUserAndMembership` | internalMutation | `internal` (Phase 1.3) | `tokenIdentifier`, `workosUserId`, `email?`, `fullName?`, `tenantId`, `role`, `workosOrganizationMembershipId?` | Upserts user by `tokenIdentifier` (never by email); upserts membership by (`tenantId`,`userId`) | n/a (internal) — caller is the WorkOS callback handler (Phase 2) | Writes `auditLogs` row tagged `user.reconcile`. Trusts the supplied role claim from WorkOS; preserves explicit local suspensions. | — | 1.3 |

## venues.ts

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned today | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `venues.listByTenant` | query | `game_master` (hardened) | `tenantId: v.id("tenants")`, `limit?` | `args.tenantId` | `requireRole(ctx, args.tenantId, ["owner","game_master"])` — throws `AppError` on auth failure | none — venue docs returned only to owner/game_master | ✅ 3.1 |
| `venues.createVenue` | mutation | `game_master` (hardened) | `tenantId`, `name`, `courtCount`, `address?` | `args.tenantId` (checked before any write) | `requireRole(ctx, args.tenantId, ["owner","game_master"])` | none — returns `{ success, venueId? }` only | ✅ 3.1 |
| `venues.updateVenue` | mutation | `game_master` (hardened) | `tenantId`, `venueId`, `name?`, `courtCount?`, `address?` | derived: `venueId` → `venue.tenantId`; client `tenantId` only surfaces a stale-client mismatch | `requireRole(ctx, venue.tenantId, ["owner","game_master"])` | none — returns `{ success }` only | ✅ 3.1 |
| `venues.deleteVenue` | mutation | `game_master` (hardened) | `tenantId`, `venueId` | derived: `venueId` → `venue.tenantId`; client `tenantId` only surfaces a stale-client mismatch | `requireRole(ctx, venue.tenantId, ["owner","game_master"])` | none — returns `{ success }` only | ✅ 3.1 |

## players.ts

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned today | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `players.listByTenant` | query | `game_master` (hardened) | `tenantId: v.id("tenants")`, `limit?` | `args.tenantId` | `requireRole(ctx, args.tenantId, ["owner","game_master"])` — throws `AppError` on auth failure | Full player docs (incl. `email`, `phone`, `notes`, `optIn`) returned only to owner/game_master; bounded by `limit` (default/max 500) | ✅ 3.2 |
| `players.registerTournamentTeam` | mutation | `player` (intended) / **unauthenticated today, creates accountless players** | `tenantId`, `tournamentId`, `teamName`, `skillTier`, `player1`, `player2` | `tournamentId` → `tournament.tenantId` (mismatch check); `args.tenantId` client-supplied | `requireTenantMembership` + registered-profile-only (per Task 3.5) | Creates accountless persistent players from public registration (non-goal) | 3.5 |
| `players.getById` | query | `game_master` (hardened; admin-only pending Task 4.1) | `playerId: v.id("players")` | derived: `playerId` → `player.tenantId` | `requireOwnPlayer(ctx, playerId)` — admin-only; players `FORBIDDEN` (fail-closed until `players.userId`); missing → `RESOURCE_NOT_FOUND` | Full player doc returned only to owner/game_master | ✅ 3.2 |
| `players.createPlayer` | mutation | `game_master` (hardened) | `tenantId`, names, skill, contact, gender, avatar, notes, optIn | `args.tenantId` (checked before insert) | `requireRole(ctx, args.tenantId, ["owner","game_master"])` | none — returns `{ success, playerId? }` only; only `AppError` → `{success:false, error}` | ✅ 3.2 |
| `players.updatePlayer` | mutation | `game_master` (hardened; admin-only pending Task 4.1) | `tenantId`, `playerId`, many optional fields | derived: `playerId` → `player.tenantId`; client `tenantId` only surfaces a stale-client mismatch | `requireOwnPlayer(ctx, playerId)` — admin-only; players `FORBIDDEN` | none — returns `{ success }` only; patch never sets `_id`/`tenantId`/`createdAt`; no identity-link arg exists | ✅ 3.2 |
| `players.deletePlayer` | mutation | `game_master` (hardened; admin-only pending Task 4.1) | `tenantId`, `playerId` | derived: `playerId` → `player.tenantId`; client `tenantId` only surfaces a stale-client mismatch | `requireOwnPlayer(ctx, playerId)` — admin-only; players `FORBIDDEN` | none — returns `{ success }` only | ✅ 3.2 |
| `players.getPlayerStats` | query | `game_master` (hardened; admin-only pending Task 4.1) | `playerId`, `windowDays?` | derived: `playerId` → `player.tenantId` | `requireOwnPlayer(ctx, playerId)` — admin-only; players `FORBIDDEN` | none — returns aggregate `{ wins, losses, pointsFor, pointsAgainst, truncated }` only | ✅ 3.2 |

## stats.ts

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned today | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `stats.getLeaderboard` | query | `public_read` (hardened) | `tenantId`, `limit?`, `windowDays?` | `args.tenantId` (validated active tenant) | n/a — public projection; active-tenant gate; cross-tenant/missing player rows excluded | none (safe projection): `{ entries: [{ playerId, firstName, lastName, wins, losses, pointsFor, pointsAgainst }], truncated }`. First/last name are allowed public display fields; collision-aware disambiguation is Task 4.6 | ✅ 3.2 (+4.6 display names) |

## authzProbe.ts (test harness only)

Thin `internalQuery` wrappers that exercise `convex/lib/authz.ts` from convex-test. They are **not** part of the public app surface (registered as `internalQuery`, so unreachable from the browser) and will be deleted once Phase 3 hardens authorization into real functions. They are listed here so the matrix remains a complete inventory.

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `authzProbe.requireAuthenticatedUserProbe` | internalQuery | `internal` (test only) | `tenantId: v.id("tenants")` | none | `requireAuthenticatedUser` | none | — |
| `authzProbe.requireTenantMembershipProbe` | internalQuery | `internal` (test only) | `tenantId: v.id("tenants")` | `args.tenantId` | `requireTenantMembership` | returns `{ role, status }` only | — |
| `authzProbe.requireRoleProbe` | internalQuery | `internal` (test only) | `tenantId`, `allowedRoles`, `requireTrustedWorkOSClaim?` | `args.tenantId` | `requireRole` | returns `{ role }` only | — |
| `authzProbe.requireOwnerProbe` | internalQuery | `internal` (test only) | `tenantId: v.id("tenants")` | `args.tenantId` | `requireOwner` | returns `{ role }` only | — |
| `authzProbe.requirePlayerProfileProbe` | internalQuery | `internal` (test only) | `tenantId: v.id("tenants")` | `args.tenantId` | `requirePlayerProfile` (currently fails closed pending Task 4.1) | none — fails with `PROFILE_REQUIRED` | — |
| `authzProbe.requireOwnPlayerProbe` | internalQuery | `internal` (test only) | `playerId: v.id("players")` | `playerId` → `player.tenantId` | `requireOwnPlayer` | none — fails with `FORBIDDEN` for non-admins / cross-tenant | — |

## migrations/usersToMemberships.ts (Phase 1.5)

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `migrations/usersToMemberships.backfillTenant` | internalMutation | `internal` (operator-invoked) | `tenantId`, `ownerEmails`, `gameMasterEmails`, `suspendUnclassified?`, `batchSize?` | Explicit `tenantId` only; never `.first()` across tenants | n/a (internal migration) | n/a — internal; writes `auditLogs` row per membership created | — |

## migrations/matchHistoryParticipants.ts (Phase 3.2)

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `migrations/matchHistoryParticipants.backfillTenant` | internalMutation | `internal` (operator-invoked) | `tenantId`, `cursor?`, `batchSize?`, `dryRun?` | Explicit `tenantId`; bounded pagination through `matchHistory.by_tenant`; reference tenant copied from each source match | n/a (internal migration) | n/a — returns migration counts/cursor only; idempotently creates missing `matchHistoryParticipants` rows | ✅ 3.2 |

## openPlaySessions.ts

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned today | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `openPlaySessions.createSession` | mutation | `game_master` (hardened) | `tenantId`, `venueId?`, `name`, `date`, `matchingMode` | `args.tenantId` (client-supplied); `venueId` → `venue.tenantId` checked | `requireRole(ctx, args.tenantId, ["owner","game_master"])` | none | ✅ 3.3 |
| `openPlaySessions.listByTenant` | query | `game_master` (hardened) | `tenantId`, `limit?` | `args.tenantId` (client-supplied) | `requireRole(..., ["owner","game_master"])` | Returns full session docs | ✅ 3.3 |
| `openPlaySessions.getById` | query | `game_master` (hardened) | `sessionId` | `sessionId` → `session.tenantId` | `requireRole(..., ["owner","game_master"])` | Returns full session doc | ✅ 3.3 |
| `openPlaySessions.updateSessionStatus` | mutation | `game_master` (hardened) | `sessionId`, `status` | `sessionId` → `session.tenantId` | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | none | ✅ 3.3 |
| `openPlaySessions.updateSessionMatchingMode` | mutation | `game_master` (hardened) | `sessionId`, `matchingMode` | `sessionId` → `session.tenantId` | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | none | ✅ 3.3 |
| `openPlaySessions.checkInPlayer` | mutation | `game_master` (intended) / **unauthenticated today** | `sessionId`, `playerId` | `sessionId` → `session.tenantId`; `playerId` → `player.tenantId` (cross-check today) | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | No auth; allows anyone to check in | 3.4 |
| `openPlaySessions.registerAndCheckInGuest` | mutation | `game_master` (intended) / **unauthenticated today, creates accountless player** | `tenantId`, `sessionId`, names, `skillTier`, `email?`, `phone?`, `gender?` | `sessionId` → `session.tenantId` (compared to `args.tenantId`); `args.tenantId` client-supplied | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | Creates persistent player from public call (non-goal); collects contact data (non-goal for walk-ins) | 3.4 / 5.4 (walk-in) |
| `openPlaySessions.updatePlayerStatus` | mutation | `game_master` (intended) / **unauthenticated today** | `sessionId`, `playerId`, `status` | `sessionId` + `playerId` → `sessionPlayer` row; tenant not derived | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | No auth; lets anyone move players in queue | 3.4 |
| `openPlaySessions.getSessionPlayers` | query | `game_master` (hardened) | `sessionId` | `sessionId` → `session.tenantId` | `requireRole(..., ["owner","game_master"])` | Returns `playerDetails` (full player doc incl. `email`, `phone`, `notes`) | ✅ 3.3 |
| `openPlaySessions.generateMatches` | mutation | `game_master` (intended) / **unauthenticated today** | `sessionId` | `sessionId` → `session.tenantId` (NOT derived today) | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | No auth, no tenant derivation | 3.4 |
| `openPlaySessions.recordMatchScore` | mutation | `game_master` (intended) / **unauthenticated today** | `matchId`, `score1`, `score2` | `matchId` → `match.sessionId` → `session.tenantId` (session read today) | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | No auth; writes stats + match history from any caller | 3.4 |
| `openPlaySessions.getLiveMatches` | query | `game_master` (hardened) | `sessionId` | `sessionId` → `session.tenantId` | `requireRole(..., ["owner","game_master"])` | Returns `team1Details`/`team2Details` = full player docs incl. `email`, `phone`, `notes` | ✅ 3.3 |
| `openPlaySessions.getMatchHistory` | query | `game_master` (hardened) | `sessionId` | `sessionId` → `session.tenantId` | `requireRole(..., ["owner","game_master"])` | Returns `team1Details`/`team2Details` = full player docs | ✅ 3.3 |
| `openPlaySessions.getPublicSession` | query | `public_read` (hardened) | `sessionId` | `sessionId` → `session.tenantId` | none — public projection | Returns safe session fields, no tenant ID | ✅ 3.3 |
| `openPlaySessions.getPublicSessionPlayers` | query | `public_read` (hardened) | `sessionId` | `sessionId` → `session.tenantId` | none — public projection | Returns safe player fields bound to `take(100)` | ✅ 3.3 |
| `openPlaySessions.getPublicLiveMatches` | query | `public_read` (hardened) | `sessionId` | `sessionId` → `session.tenantId` | none — public projection | Returns safe match fields bound to `slice(0, 50)` | ✅ 3.3 |
| `openPlaySessions.getPublicMatchHistory` | query | `public_read` (hardened) | `sessionId` | `sessionId` → `session.tenantId` | none — public projection | Returns safe match fields bound to `slice(0, 50)` | ✅ 3.3 |
| `openPlaySessions.updateMatchCourt` | mutation | `game_master` (intended) / **unauthenticated today** | `matchId`, `courtName` | `matchId` → `match.sessionId` → `session.tenantId` (NOT derived today) | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | No auth | 3.4 |
| `openPlaySessions.swapMatchPlayers` | mutation | `game_master` (intended) / **unauthenticated today** | `matchId`, `playerAId`, `playerBId` | `matchId` → `match.sessionId` → `session.tenantId` (NOT derived today) | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | No auth | 3.4 |
| `openPlaySessions.substituteMatchPlayer` | mutation | `game_master` (intended) / **unauthenticated today** | `matchId`, `outgoingPlayerId`, `incomingPlayerId` | `matchId` → `match.sessionId` → `session.tenantId` (NOT derived today) | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | No auth | 3.4 |
| `openPlaySessions.cancelMatch` | mutation | `game_master` (intended) / **unauthenticated today** | `matchId` | `matchId` → `match.sessionId` → `session.tenantId` (NOT derived today) | `requireRole(ctx, session.tenantId, ["owner","game_master"])` | No auth | 3.4 |

## tournaments.ts

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned today | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `tournaments.listByTenant` | query | `game_master` (intended) / **unauthenticated today** | `tenantId: v.id("tenants")` | `args.tenantId` (client-supplied) | `requireRole(..., ["owner","game_master"])` (admin); public published-list projection later | Returns full tournament docs to any caller | 3.5 |
| `tournaments.getActiveTournament` | query | `public_read` (intended) / **unauthenticated today** | `tenantId` | `args.tenantId` (client-supplied) | Public projection | Returns tournament doc to any caller | 3.5 |
| `tournaments.getById` | query | `player`/`public_read` (intended) / **unauthenticated today** | `tournamentId: v.id("tournaments")` | `tournamentId` → `tournament.tenantId` | Public projection / membership | Returns full tournament doc to any caller | 3.5 |
| `tournaments.getRegisteredTeams` | query | `player`/`public_read` (intended) / **unauthenticated today, returns player names** | `tournamentId` | `tournamentId` → `tournament.tenantId` (NOT derived today) | Public projection; display names only | Returns entrant names + player first/last names | 3.5 / 4.6 |
| `tournaments.generateBracket` | mutation | `game_master`/`owner` (intended) / **mismatch check only today** | `tenantId`, `tournamentId` | `tournamentId` → `tournament.tenantId` (compared to `args.tenantId`) | `requireRole(ctx, tournament.tenantId, ["owner","game_master"])` | Client `tenantId` trusted; no role check | 3.5 |
| `tournaments.createTournament` | mutation | `game_master` (intended) / **unauthenticated today** | `tenantId`, `name`, `date`, `format`, `location?` | `args.tenantId` (client-supplied) | `requireRole(..., ["owner","game_master"])` | No auth; client `tenantId` trusted | 3.5 |
| `tournaments.updateTournamentStatus` | mutation | `game_master`/`owner` (intended) / **mismatch check only today** | `tenantId`, `tournamentId`, `status` | `tournamentId` → `tournament.tenantId` (compared) | `requireRole(ctx, tournament.tenantId, ["owner","game_master"])` | Client `tenantId` trusted; no role check | 3.5 |
| `tournaments.updateTeamSeed` | mutation | `game_master`/`owner` (intended) / **mismatch check only today** | `tenantId`, `tournamentId`, `entrantId`, `seed` | `tournamentId` → `tournament.tenantId` (compared) | `requireRole(ctx, tournament.tenantId, ["owner","game_master"])` | Client `tenantId` trusted; no role check | 3.5 |
| `tournaments.getTournamentBracket` | query | `public_read` (intended) / **unauthenticated today** | `tournamentId` | `tournamentId` → `tournament.tenantId` (NOT derived today) | Public projection | Returns entrant/winner names to any caller | 3.5 |
| `tournaments.getTournamentView` | query | `player`/`public_read` (intended) / **mismatch check today, returns player names** | `tenantId`, `tournamentId` | `tournamentId` → `tournament.tenantId` (compared to `args.tenantId`) | Public projection / membership | Returns teams with `players` first/last names | 3.5 / 4.6 |
| `tournaments.recordTournamentScore` | mutation | `game_master`/`owner` (intended) / **mismatch check only today** | `tenantId`, `matchId`, `score1`, `score2` | `matchId` → `match.tournamentId` → `tournament.tenantId` (compared) | `requireRole(ctx, tournament.tenantId, ["owner","game_master"])` | Client `tenantId` trusted; no role check | 3.5 |

## Notes for Phase 3

- **Tenant derivation gaps.** Every `*_by_sessionId`/`*_by_matchId` mutation
  in `openPlaySessions.ts` and `tournaments.getRegisteredTeams`/
  `getTournamentBracket` currently take a resource ID and never derive the
  tenant from it; Phase 3 must load the resource, derive `tenantId`, then
  call `requireRole`. The client `tenantId` arg on these must be removed or
  ignored as an authority source.
- **Accountless player creation from public calls.**
  `players.registerTournamentTeam` and
  `openPlaySessions.registerAndCheckInGuest` create persistent `players` rows
  from unauthenticated public calls. Task 3.5 / 5.4 replace these with
  registered-profile-only and event-only walk-in paths per the design.
- **Private fields in public reads.** `getSessionPlayers`, `getLiveMatches`,
  `getMatchHistory`, `getRegisteredTeams`, `getTournamentView`, `getLeaderboard`,
  and the various `getById`/`listByTenant` queries return full docs including
  `email`, `phone`, `notes`, `optIn`, and WorkOS identity. Phase 3 splits safe
  public projections; Phase 4.6 adds collision-aware display names.
- **`tenants.createWorkspace`** was removed in Task 2.4. Tenant creation is
  limited to internal bootstrap functions.

## Phase 2 additions

| Function | Kind | Access | Args | Tenant path | Helper | Private fields returned today | Phase 3 task |
|---|---|---|---|---|---|---|---|
| `tenants.findByOrgId` | internalQuery | `internal` | `workosOrganizationId: v.string()` | `args.workosOrganizationId` → `by_workosOrganizationId` | n/a (internal) | tenant doc | — |
| `tenants.findBySlug` | internalQuery | `internal` | `slug: v.string()` | `args.slug` → `by_slug` | n/a (internal) | tenant doc | — |
| `workosActions.resolveUserProfile` | internalAction | `internal` (Node-only WorkOS profile lookup) | `workosUserId` derived from a verified identity or signed webhook | n/a | n/a (server-side only) | WorkOS email and display name only | — |
| `workosActions.ingestSignedWebhook` | internalAction | `internal` (Node-only signature verification) | `rawBody`, `signatureHeader`, `expectedOrganizationId` | organization id is matched server-side against canonical `WORKOS_ORGANIZATION_ID` | n/a (server-side, called from `http.ts`) | none — returns `{ status, eventId }` only | — |
| `workosSync.recordEvent` | internalMutation | `internal` | normalized receipt payload | n/a (writes `workosWebhookReceipts`) | n/a (internal) | none — receipt row only | — |
| `workosSync.applyEvent` | internalMutation | `internal` | normalized membership event | server-resolved tenant via `by_workosOrganizationId` | n/a (internal; trusted server-side data only) | none — applies user/membership upsert + audit | — |
| `callback.reconcileWorkosCallback` | action | `player` (token-authenticated; derives identity server-side) | **none** (`args: {}`) | identity → `organization_id`/`org_id` claim → `internal.tenants.findByOrgId`; personal-account fallback → `PICKLE_POINT_TENANT_SLUG` via `findBySlug` | Convex validates the WorkOS JWT; user/org/role come from `ctx.auth.getUserIdentity()`, while profile fields are fetched server-side from WorkOS using the verified subject. No user/org/tenant/role/profile field is accepted as an argument. | none — returns coarse `{ status }` only | — |
