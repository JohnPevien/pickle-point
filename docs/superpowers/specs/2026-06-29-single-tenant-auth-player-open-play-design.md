---
title: Single-Tenant Authentication, Player Accounts, and Open Play
---

# Single-Tenant Authentication, Player Accounts, and Open Play

## Summary

Pickle Point will ship its MVP as one fixed tenant on one deployment. The implementation must preserve tenant boundaries so the product can later host many tenants without redesigning identity, membership, player, or event data.

WorkOS AuthKit remains the identity provider. It owns accounts, passwords, verified email, browser sessions, the administrative organization, owner/Game Master invitations, and administrative roles. Convex owns application tenancy, local membership projections, player profiles, authorization, events, RSVPs, check-ins, queues, matches, scores, and results.

This specification replaces self-service workspace creation with an internally seeded tenant, gives verified players tenant-scoped accounts and profiles, hardens all Convex functions, and completes the public and administrative open-play lifecycle.

## Goals

- Ship one fixed tenant with a friendly workspace URL.
- Preserve a clean upgrade path to many tenants on one deployment.
- Use Convex's automatic WorkOS AuthKit configuration rather than replacing it.
- Support one owner and multiple Game Masters invited through WorkOS.
- Let players self-register through the tenant workspace after email verification.
- Give authenticated players a reusable profile and self-service RSVP.
- Keep Game Master check-in authoritative.
- Support event-only walk-ins without creating reusable player identities.
- Provide public realtime live matches, queue status, and an event leaderboard.
- Enforce tenant and role authorization inside Convex, not only in the UI.
- Migrate existing data without destructive, all-at-once schema changes.

## Non-goals

- Creating multiple tenants in the MVP.
- Tenant billing or subscription management.
- In-application owner/Game Master invitation management.
- Custom invitation expiry; WorkOS default invitation behavior is used.
- Automatically linking new accounts to existing players by name, phone, or email.
- Long-term statistics for walk-ins or anonymous match fillers.
- Redesigning tournament partner selection or invitation UX in this project.
- Storing WorkOS passwords, refresh tokens, or other secret identity data in Convex.

## Locked product decisions

- MVP topology: one tenant, one deployment.
- Future topology: many tenants on the same deployment.
- Workspace URL: `/{workspace-slug}`.
- Public workspace home: branding and upcoming events are visible without login.
- WorkOS session duration: up to seven days for all authenticated accounts.
- Game Master invitation expiry: WorkOS default; no custom `expiresInDays` setup.
- Administrative roles: one `owner`, multiple `game_master` accounts.
- Game Master invitations: sent through the WorkOS dashboard for MVP.
- Player onboarding: self-registration from the tenant link with verified email.
- Player creation: every newly registered account creates a new player profile.
- Required player fields: full name and nickname.
- Duplicate nicknames: allowed.
- Disambiguation: show `Nickname (Full Name)` only when the currently visible group contains an actual case-insensitive nickname collision.
- Owner and Game Master accounts may complete player registration and participate using the same login.
- Open-play Join creates an RSVP, not a check-in or queue entry.
- Only an owner or Game Master may check a participant in.
- Late RSVP and check-in remain open until the event's effective end.
- Pending RSVPs become no-shows at the event's effective end.
- Walk-ins are event-only and excluded from persistent leaderboards.
- Open play is doubles-only.
- If exactly three eligible unassigned players remain and a court is available, a Game Master may add one anonymous match filler.

## System responsibilities

| Concern | Source of truth |
|---|---|
| Account, password, email verification | WorkOS |
| Seven-day browser session | WorkOS/AuthKit |
| Owner/Game Master invitations | WorkOS organization |
| Owner/Game Master administrative role | WorkOS, projected into Convex |
| Tenant, slug, branding, timezone | Convex |
| Application membership and authorization | Convex |
| Player profile and participation | Convex |
| Events, queues, matches, and scores | Convex |

WorkOS and Convex are separate services. Convex stores only a local application projection of the identity: the trusted WorkOS token identifier, WorkOS user ID, tenant membership, application role, and optional player profile link. It never stores identity-provider credentials.

The local projection exists so Convex can authorize transactional and realtime application operations without making an external WorkOS API call for every query or mutation. WorkOS remains authoritative for administrative organization membership. Login reconciliation and signed webhook events keep the projection current. A stale Convex administrative role cannot grant access if trusted WorkOS claims no longer contain the required organization role.

## MVP and future topology

### MVP

- One internally seeded Convex tenant.
- One friendly tenant slug.
- One corresponding WorkOS organization for administrative users.
- Owner and Game Masters are WorkOS organization members.
- Players are WorkOS users with local Convex tenant memberships; they need not be administrative WorkOS organization members.
- Root navigation may redirect to the fixed tenant slug.

### Future multi-tenant upgrade

Adding a tenant requires a new Convex tenant row, friendly slug, WorkOS administrative organization, owner membership, and branding. Users, memberships, players, authorization helpers, routes, and event tables do not require structural redesign.

## Data model

### `tenants`

Add:

- `slug: string`
- `timezone: string`, initially `Asia/Manila`
- `workosOrganizationId: string`
- `status: "active" | "disabled"`

Keep existing name, contact, logo, and color fields.

Indexes:

- `by_slug`
- `by_workosOrganizationId`

Slug and WorkOS organization ID uniqueness are enforced transactionally by reading the corresponding index before insert or update.

### `users`

A user is a global verified WorkOS identity, not a tenant membership.

Fields:

- `tokenIdentifier: string`
- `workosUserId: string`
- `email: string`
- `emailNormalized: string`
- `fullName?: string`
- `createdAt: number`
- `lastSeenAt: number`

Indexes:

- `by_tokenIdentifier`
- `by_workosUserId`
- `by_emailNormalized`

The current `users.tenantId` field is retained temporarily during migration and removed only after all membership reads have switched.

### `tenantMemberships`

Fields:

- `tenantId: Id<"tenants">`
- `userId: Id<"users">`
- `role: "owner" | "game_master" | "player"`
- `status: "active" | "suspended"`
- `workosOrganizationMembershipId?: string`
- `createdAt: number`
- `updatedAt: number`

Indexes:

- `by_userId`
- `by_tenantId`
- `by_tenantId_and_userId`
- `by_workosOrganizationMembershipId`

There is one membership per user/tenant pair. An owner or Game Master who also plays keeps the administrative role and receives a player profile; no second membership is required.

### `players`

Persistent players are account-backed after this migration. Existing unlinked records remain readable as legacy data but are not automatically claimed.

Add or migrate to:

- `tenantId: Id<"tenants">`
- `userId?: Id<"users">`
- `profileKind: "account" | "legacy_unclaimed"`
- `fullName: string`
- `nickname: string`
- Existing approved skill, DUPR, avatar, gender, and consent fields
- `createdAt: number`
- `updatedAt: number`

Indexes:

- `by_tenantId`
- `by_userId`
- `by_tenantId_and_userId`

New account-backed profiles require `userId`. One account-backed profile is permitted per user/tenant. Nickname is not unique.

Nickname disambiguation is computed for the bounded visible participant set. If normalized nickname frequency is one, show the nickname. If greater than one, show `Nickname (Full Name)` for all colliding participants.

### `openPlaySessions`

Add:

- `publicSlug: string`
- `startAt: number`
- `endAt: number`
- `timezone: string`
- `courtCount: number`
- `status: "draft" | "scheduled" | "check_in" | "live" | "completed" | "cancelled"`
- Existing matching mode

The event timezone is a snapshot. Start and end are stored as UTC timestamps. Court count defaults from the venue but is independently editable for the event.

Indexes include tenant/public slug and tenant/start time combinations needed for public upcoming-event queries.

### `sessionParticipants`

This replaces the overloaded role of current `sessionPlayers` while allowing a compatibility migration.

Fields:

- `sessionId: Id<"openPlaySessions">`
- `playerId?: Id<"players">`
- `participantType: "registered_player" | "walk_in"`
- `fullNameSnapshot: string`
- `nicknameSnapshot: string`
- `registrationStatus: "registered" | "withdrawn" | "no_show"`
- `attendanceStatus: "pending" | "checked_in" | "left"`
- `playStatus: "not_queued" | "queued" | "playing" | "sitting_out" | "paused" | "finished"`
- `rsvpAt?: number`
- `checkedInAt?: number`
- Existing bounded queue and fairness metadata

Indexes:

- `by_sessionId`
- `by_playerId`
- `by_sessionId_and_playerId`
- `by_sessionId_and_registrationStatus`
- `by_sessionId_and_attendanceStatus`
- `by_sessionId_and_playStatus_and_queuePosition`

Registered participants require `playerId`. Walk-ins have no `playerId` and are created by an owner or Game Master. Walk-in contact data is not collected for MVP.

### `sessionMatches`

Match slots become a discriminated union:

- Real participant: `{ kind: "participant", sessionParticipantId }`
- Match-only filler: `{ kind: "anonymous_filler", label: "Anonymous Player" }`

The filler never receives a participant row, queue position, profile, leaderboard row, or persistent statistics.

Matches retain court, scores, lifecycle state, completion/cancellation timestamps, and score-correction metadata.

### Event statistics

Add an event-scoped statistics table keyed by session and participant:

- Matches played
- Wins
- Losses
- Points for
- Points against
- Point differential

Registered players and walk-ins appear in the event leaderboard. Only rows backed by an account player contribute to persistent career statistics.

Score correction must deterministically recompute affected statistics or apply an exact reversible delta. It must never increment a corrected result twice.

### `auditLogs`

Store tenant, actor user, action, resource type/ID, timestamp, and safe before/after metadata for:

- Administrative membership reconciliation
- Event lifecycle changes
- Manual check-in reversal
- Match cancellation or substitution
- Score creation/correction
- Tenant setting changes

### `workosWebhookReceipts`

Store WorkOS event ID, event type, processing status, attempts, and processed timestamp. This makes webhook retries idempotent.

## Authentication and onboarding flows

### Automatic AuthKit configuration

Keep the current `convex.json` AuthKit configuration and `convex/auth.config.ts`. Convex continues to provision/configure WorkOS environments, redirect URIs, CORS origins, and deployment environment variables.

Automatic provider configuration does not create application tenants, memberships, player profiles, roles, or authorization rules; those remain part of this design.

### Tenant bootstrap

1. Create the tenant's WorkOS organization.
2. Define `owner` and `game_master` WorkOS roles.
3. Internally seed the fixed Convex tenant with slug, timezone, branding, and WorkOS organization ID.
4. Invite the owner's email through WorkOS with the owner role.
5. The owner's first verified login creates the Convex user and owner membership.
6. Re-running bootstrap returns the same tenant and does not create duplicates.

There is no public tenant-creation endpoint or setup form after migration.

### Player registration

1. A player opens `/{workspace-slug}`.
2. Public branding and upcoming events load without authentication.
3. Register or Join sends the player through WorkOS with the workspace return path preserved.
4. WorkOS verifies the email.
5. The callback re-resolves the tenant from the trusted slug; a browser-supplied tenant ID is never authoritative.
6. Convex idempotently creates the user and player membership.
7. The player completes full name and nickname.
8. Convex creates exactly one account-backed player profile for the user/tenant.
9. The player lands on the tenant player dashboard.

Callback replay, page refresh, or double submission cannot create duplicate users, memberships, or profiles.

### Game Master invitation

1. The owner sends an invitation through the WorkOS dashboard.
2. The invitation targets the administrative organization with `game_master`.
3. WorkOS default invitation expiration is used.
4. The recipient accepts, verifies email, and logs in.
5. The application validates organization and role claims.
6. Convex creates or updates the user and Game Master membership.
7. The Game Master lands on the administrative dashboard.
8. They may complete normal player-profile registration using the same account.

No invitation-management UI or custom invitation sender is built for MVP.

### Login routing

- Active owner or Game Master: administrative dashboard.
- Active player with profile: player dashboard.
- Active player without profile: profile completion.
- Suspended membership: access-denied page.
- Valid WorkOS account without membership: may join only through a valid workspace slug.
- No authenticated account may create a tenant.

### Session policy

Set the AuthKit application cookie maximum age to seven days:

```text
WORKOS_COOKIE_MAX_AGE=604800
```

There is no custom one-day administrative reauthentication layer. The previously discussed one-day value referred to invitation validity and was removed when custom invitation expiry was rejected.

### WorkOS reconciliation

- Login/callback performs immediate user and membership reconciliation.
- Signed WorkOS webhook events synchronize administrative organization membership changes.
- Current trusted WorkOS organization/role claims are required for owner/Game Master authorization.
- Convex membership alone cannot elevate an account when WorkOS no longer grants the role.
- Missing or inconsistent administrative claims fail closed and produce a supportable access-denied state.

## Route design

Public:

- `/{workspaceSlug}`: tenant home and upcoming events
- `/{workspaceSlug}/open-play/{eventSlug}`: event overview/live summary
- `/{workspaceSlug}/open-play/{eventSlug}/queue`: public realtime queue
- `/{workspaceSlug}/open-play/{eventSlug}/leaderboard`: public event leaderboard
- Existing public tournament/live routes migrate from raw tenant IDs to slugs

Authenticated player:

- `/{workspaceSlug}/dashboard`
- `/{workspaceSlug}/profile`
- Event Join/Withdraw actions

Administrative:

- `/{workspaceSlug}/admin/*`

The existing `[tenant]` route parameter changes semantically from raw Convex tenant ID to friendly slug. Backend queries resolve slug to tenant and then perform access checks.

## Authorization model

Every public Convex function must be classified as public read, authenticated player, Game Master, owner, or internal.

### Central helpers

- `requireAuthenticatedUser(ctx)`
- `requireTenantMembership(ctx, tenantId)`
- `requireRole(ctx, tenantId, allowedRoles)`
- `requireOwner(ctx, tenantId)`
- `requirePlayerProfile(ctx, tenantId)`
- `requireOwnPlayer(ctx, playerId)`
- `requireOwnParticipation(ctx, participationId)`

Resource mutation functions prefer a resource ID and derive tenant server-side:

```text
venueId -> venue.tenantId -> requireRole(...)
sessionId -> session.tenantId -> requireRole(...)
playerId -> player.tenantId -> requireOwnPlayer(...)
```

Client-provided tenant IDs are never accepted as proof of access.

### Capability matrix

| Capability | Public | Player | Game Master | Owner |
|---|---:|---:|---:|---:|
| View branding/upcoming events | yes | yes | yes | yes |
| View public live results, queue, bracket | yes | yes | yes | yes |
| View private profile/history | no | own | yes | yes |
| Edit player profile | no | own safe fields | yes | yes |
| RSVP/withdraw before check-in | no | own | yes | yes |
| Check in participants | no | no | yes | yes |
| Add/manage walk-ins | no | no | yes | yes |
| Manage queue, matches, scores | no | no | yes | yes |
| Manage venues/events | no | no | yes | yes |
| Edit tenant workspace settings | no | no | no | yes |
| Manage administrative access | no | no | no | yes |

Game Masters may correct application profile and skill data but cannot change the WorkOS identity linked to a player.

### Public data boundary

Public responses may contain tenant branding, safe event details, participant count, live match state, nickname/full-name disambiguation, queue state, and results.

They must not contain email, phone, internal notes, WorkOS IDs, memberships, consent metadata, private administrative state, pending RSVPs, or no-show identities.

## Open-play lifecycle

### Event lifecycle

```text
draft -> scheduled -> check_in -> live -> completed
                                -> cancelled
```

- Draft is administrative-only.
- Scheduled is published publicly.
- Check-in accepts arrivals.
- Live enables queue and matchmaking.
- Completed freezes normal operations and finalizes results.
- Cancelled does not produce no-shows.

### RSVP and attendance

- Join creates an idempotent registered/pending participation.
- RSVP alone never enters matchmaking.
- A player may withdraw while not checked in.
- Withdrawal after check-in is rejected; a Game Master changes attendance/play state.
- Only an owner or Game Master checks participants in.
- Check-in changes attendance to checked-in and play state to queued.
- Late Join and check-in remain valid until effective event end.
- Effective end is `endAt` or earlier manual completion.

### No-show finalization

At effective event end:

- Registered and pending becomes no-show.
- Checked-in remains valid.
- Withdrawn remains withdrawn.
- Walk-ins are unaffected.
- Cancelled events create no no-shows.

Use an idempotent scheduled internal Convex function. It re-reads event status and current `endAt` so stale scheduled work cannot finalize a rescheduled event early.

### Walk-ins

- Only an owner or Game Master creates a walk-in.
- Required fields are full name, nickname, and skill.
- Creation immediately checks in and queues the walk-in.
- No account, reusable player profile, or contact data is created.
- Event results retain the participant snapshot.
- Walk-ins appear only in event results and never in persistent leaderboards.

## Complete open-play operations

### Event creation and courts

An event includes name, venue, start/end, timezone snapshot, court count, matching mode, and lifecycle status. Moving from draft to scheduled publishes the event. Court count defaults from the venue but may be overridden for the event. Courts default to `Court 1`, `Court 2`, and so on.

At most one active match may claim a court.

### Public queue

The public queue contains only checked-in operational state:

- Nickname
- Full name only when an actual case-insensitive nickname collision exists in the visible participant group
- Queue position
- Queued, playing, sitting out, or paused state
- Assigned court
- Matches played

Convex subscriptions update the page in realtime.

### Match generation

- Open play is doubles-only.
- Only checked-in eligible participants may be selected.
- A participant cannot be assigned to multiple active matches.
- Four real participants create a normal match.
- When exactly three eligible unassigned real participants remain and a court is available, a Game Master may explicitly add one anonymous filler.
- With fewer than three eligible real participants, no match starts.
- The anonymous filler exists only in the match slot and is excluded from queue, event leaderboard, identity history, and all statistics. The completed match retains the filler label for event-result display.
- Completing or cancelling a match releases the court.

### Score entry

Only owner/Game Masters enter or correct scores.

- Scores are non-negative whole numbers.
- Final scores cannot tie.
- MVP does not enforce first-to-11 or win-by-two.
- Recording a score atomically completes the match, determines winner/loser, updates event stats, releases the court, and returns eligible real players according to the matching mode.
- Correcting a score cannot double-count statistics.
- Actor and correction metadata are audited.

### Event leaderboard

Metrics:

- Matches played
- Wins
- Losses
- Points for
- Points against
- Point differential

Ranking:

1. Wins descending
2. Point differential descending
3. Points for descending
4. Display name ascending

Registered players and walk-ins appear on the event leaderboard. Anonymous fillers do not. Only registered account-backed players contribute to persistent career statistics.

### Completion

- Active matches must be completed or cancelled first.
- Pending RSVPs become no-shows.
- Queue mutations stop.
- Event leaderboard becomes final.
- Public results remain readable.
- Registered-player career statistics are finalized.
- Walk-in results remain event-only snapshots.
- Post-completion corrections require owner/Game Master authorization and deterministic recalculation.

## Tournament boundary

Tournament entrants must reference persistent registered player profiles. Walk-ins and anonymous fillers are not valid tournament identities. Existing tournament functionality receives the same tenant authorization hardening, but partner selection/invitation UX is a separate future design.

## Error model

Use stable application errors:

- `UNAUTHENTICATED`
- `FORBIDDEN`
- `MEMBERSHIP_SUSPENDED`
- `PROFILE_REQUIRED`
- `EVENT_NOT_OPEN`
- `ALREADY_REGISTERED`
- `ALREADY_CHECKED_IN`
- `RESOURCE_NOT_FOUND`
- `TENANT_MISMATCH`
- `CONFLICT`
- `VALIDATION_ERROR`

Public errors do not reveal private identity or membership existence. WorkOS synchronization failures retain data, deny administrative elevation, and remain retryable.

## Migration and rollout

Use widen-migrate-narrow.

1. Add optional schema fields, new tables, and new indexes.
2. Identify the canonical production tenant explicitly; do not select it by arbitrary first-row order.
3. Seed slug, timezone, status, and WorkOS organization ID idempotently.
4. Backfill current `users.tenantId` into memberships.
5. Assign the configured owner email to owner and approved staff to Game Master.
6. Suspend unclassified existing users pending review rather than granting access silently.
7. Mark current accountless players `legacy_unclaimed`; never auto-link them to new accounts.
8. Preserve noncanonical tenant data in disabled/quarantined state until reviewed; do not merge or delete automatically.
9. Add participation snapshots and split status fields alongside legacy session data.
10. Dual-read during compatibility rollout.
11. Migrate matches and event statistics in bounded, resumable batches.
12. Switch all writes to the new model.
13. Verify row counts, references, authorization, and historical views.
14. Remove obsolete required fields in a later deployment.

All seeds and migrations must be idempotent, bounded, observable, and resumable.

## Implementation phases

1. Identity, tenant, membership, and authorization foundation.
2. WorkOS organization reconciliation and webhook handling.
3. Fixed-tenant bootstrap and removal of public workspace creation.
4. Player signup, profile completion, and dashboard.
5. Function-by-function Convex authorization hardening.
6. RSVP, Game Master check-in, withdrawal, and no-show finalization.
7. Event participants, walk-ins, and anonymous match fillers.
8. Public live page, queue, scoring, and event leaderboard.
9. Data migration, compatibility switch, and cleanup.
10. End-to-end security, concurrency, privacy, and realtime verification.

The implementation plan will split these phases into worker-sized tasks with explicit dependencies, file targets, tests, and review gates.

## Verification requirements

### Unit and function tests

- Email, slug, name, nickname, and display normalization.
- Actual-collision-only nickname disambiguation.
- Every public Convex function's access class.
- Missing identity, wrong tenant, wrong role, suspended membership.
- Cross-tenant resource IDs.
- Player modifying another profile or participation.
- Safe public projection and hidden private fields.
- WorkOS callback and webhook idempotency.
- Legacy migration fixtures and resumability.

### Event and concurrency tests

- Duplicate Join requests.
- Join immediately before/after end.
- Late Join and Game Master check-in.
- Player self-check-in rejected.
- Withdrawal before check-in and rejection after check-in.
- Event crossing midnight.
- Reschedule with stale scheduled finalizer.
- Cancellation and early completion.
- Finalizer retry.
- Two matches claiming one court.
- One participant entering multiple matches.
- Queue allocation rollback on failed mutation.
- Duplicate score submission and score correction.
- Three real participants plus anonymous filler.
- Anonymous filler excluded from statistics.
- Walk-in excluded from persistent leaderboard.

### End-to-end checks

- Owner login and administrative access.
- WorkOS-invited Game Master acceptance and access.
- Revoked Game Master denial.
- Player registration, verified email, profile completion, and RSVP.
- Game Master check-in and late arrival.
- Walk-in lifecycle.
- Public queue/live/leaderboard privacy.
- Two-browser realtime updates.
- Full lint, type-check, tests, and production build.

## Completion criteria

- No public tenant-creation path remains.
- The fixed tenant is seeded idempotently and available by friendly slug.
- Every Convex function has an explicit access class.
- Client-supplied tenant IDs never grant authority.
- Owner and WorkOS-invited Game Masters receive correct access.
- Players self-register only inside the workspace context.
- Players can RSVP but cannot self-check-in.
- Game Masters can check in registered players and add event-only walk-ins.
- Public live, queue, and leaderboard pages update in realtime without exposing private data.
- Open play remains doubles-only and safely supports one match-only anonymous filler for three remaining real players.
- Walk-ins and fillers never enter persistent leaderboards.
- Existing event history remains readable.
- A second tenant can be added later without schema redesign.
