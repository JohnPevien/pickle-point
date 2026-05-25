# Pickle Point PRD + Cleanup TODO

## Current Cleanup Status

- The unreviewed Codex prototype work has been preserved before cleanup.
- Recovery points:
  - Git stash: `stash@{0}` with message `archive/codex-openplay-prototype-2026-05-06`
  - Archive branch: `archive/codex-openplay-prototype-2026-05-06`
  - Patch backup: `C:\tmp\pickle-point-codex-openplay-prototype-2026-05-06.patch`
- The working tree was returned to a clean baseline before creating this file.
- The prototype passed `pnpm build` and `pnpm lint`, but it should be treated as reference material only, not approved product code.

## Product Direction

Pickle Point is a realtime pickleball operations app for Game Masters: venue owners, club organizers, and anyone running open plays or small tournaments.

The MVP should support both open play and mini tournaments, with open play treated as the primary workflow because it is the frequent, recurring use case. Tournaments should be built as a basic but clean bracket workflow inspired by Challonge-style tournament management.

## Core MVP

- Game Master account and workspace setup.
- Venue or club profile owned by a Game Master.
- Player directory with reusable player records.
- All open play and tournament participants must be registered as player records before joining.
- Guest and walk-in players can join open plays and tournaments without creating login accounts, as long as the Game Master creates or selects a player record for them.
- Manual player skill ratings for markets where DUPR is uncommon.
- Optional DUPR rating field when available.
- Open play session creation.
- Player check-in and queue management.
- Smart match generation.
- Live player link or QR code for queue, up-next matches, courts, standings, and recent results.
- Game Master control screen for running a session from one page.
- Session result entry and final leaderboard.
- Mini tournament creation.
- Single elimination, double elimination, and round robin tournament formats.
- Fixed doubles teams as MVP tournament entrants.
- Live tournament bracket view for players.
- Game Master bracket control view for recording winners and advancing matches.
- Browser-openable living documentation at `/docs` for product, feature, and technical docs.

## Backend Decision

- Use Convex for persistence, backend functions, and realtime sync.
- Remove Turso and Drizzle from the target architecture.
- Do not keep `TURSO_DB_URL`, `TURSO_DB_TOKEN`, Drizzle schema files, Drizzle migrations, or SQL-first server actions in the final implementation.
- Use Convex queries and mutations for all live session and tournament state.
- Use Convex subscriptions for realtime player views and Game Master dashboards.
- Recommended auth direction: Convex with WorkOS AuthKit for a stable, B2B-friendly setup with Google/social login support.

## Implementation Sequence

Follow this order to avoid wiring UI to an unfinished backend or protecting routes before auth exists.

- [x] Phase 1 — Backend: all Convex query/mutation modules complete and lint+build passing.
- [ ] Phase 2 — Auth: WorkOS AuthKit installed, Convex auth config wired, middleware protecting admin routes.
- [ ] Phase 3 — UI: Open Play session screens, live view, and remaining admin screens.

## Testing Policy

Every feature must ship with tests. No backend function, UI component, or auth flow should be merged without a corresponding test.

- Use vitest with convex-test for all Convex query and mutation functions.
- New Convex modules must include a `*.test.ts` file in the `convex/` directory covering the happy path and key error cases.
- UI components that contain business logic should have unit or integration tests.
- `pnpm test` must pass before any phase is considered complete.

- [ ] Maintain test coverage as new Convex modules are added.
- [ ] Add tests for WorkOS auth flows when Phase 2 is implemented.
- [ ] Add tests for any UI components with non-trivial logic when Phase 3 is implemented.

## ClickUp Delivery Checklist

Source: active ClickUp tasks in the Pickle Point list.

- [x] Finalize product direction and MVP scope.
  - [x] Confirm Pickle Point as a realtime pickleball operations app for Game Masters.
  - [x] Keep open play as the primary workflow.
  - [x] Include mini tournaments in the MVP.
  - [x] Confirm the core MVP feature set:
    - [ ] Game Master account and workspace setup.
    - [ ] Venue or club profile.
    - [x] Player directory.
    - [x] Accountless guest and walk-in player records.
    - [x] Manual skill ratings.
    - [x] Optional DUPR ratings.
    - [x] Open play sessions (backend complete, UI pending).
    - [x] Smart matching (backend complete, UI pending).
    - [ ] Live links or QR codes.
    - [x] Session stats (backend complete, UI pending).
    - [x] Mini tournaments (backend complete, UI pending).
    - [x] Live bracket views (backend complete, UI pending).
    - [ ] Game Master controls (UI pending).
  - [x] Confirm guests and walk-ins can join open plays and tournaments without player login accounts when the Game Master creates or selects player records for them.
  - [x] Keep the archived Codex prototype as reference material only, not approved implementation.
- [x] Define player model and identity rules.
  - [x] Confirm no anonymous participants: every open play or tournament participant needs a registered player record.
  - [x] Support local guest and walk-in records created by Game Masters during open play check-in or tournament registration.
  - [x] Allow guest and walk-in records to remain accountless while still carrying enough profile and skill data for matchmaking, seeding, scoring, and history.
  - [x] Keep player login accounts optional for MVP participation.
  - [x] Make player records claimable or linkable to login accounts later.
  - [x] Define required player record fields:
    - [x] First name.
    - [x] Last name.
    - [x] Owning Game Master workspace or venue.
    - [x] Skill source: DUPR or manual.
    - [x] DUPR rating when skill source is DUPR.
    - [x] Manual skill level when skill source is manual.
  - [x] Define optional player fields:
    - [x] Username.
    - [x] Email.
    - [x] Phone.
    - [x] Gender.
    - [x] Avatar or photo.
    - [x] Emergency notes or private Game Master notes.
  - [ ] Define future player account fields:
    - [ ] Username.
    - [ ] Email.
    - [ ] Password or external auth identity.
  - [x] Define the manual skill scale: Beginner, Novice, Low Intermediate, High Intermediate, Advanced.
  - [ ] Decide whether long-term player identity is global at signup, local per Game Master, or hybrid.
- [x] Specify open play session workflow.
  - [x] Define session lifecycle statuses: Draft, Check-in, Live, Completed, Cancelled.
  - [x] Define session types:
    - [x] Standard Open Play for flexible rotation-focused sessions.
    - [x] Ladder Play for competitive sessions where winners move up and losing players or teams move down courts, pools, or standings over successive rounds.
  - [x] Define participant rules:
    - [x] Check players in from existing records.
    - [x] Register accountless guest or walk-in records during check-in.
    - [x] Do not require player login accounts for open play participation.
  - [x] Define matching modes:
    - [x] Auto-balanced.
    - [x] Skill-separated.
    - [x] Winners vs losers for Ladder Play rounds.
    - [x] Mixed doubles.
    - [x] Skill courts.
  - [x] Define fallback behavior when ideal matching cannot be satisfied.
  - [ ] Define Game Master manual adjustment controls for generated matches.
  - [ ] Define fair sit-out rotation.
  - [x] Define winner and score recording.
  - [x] Define stats shown during and after sessions.
  - [ ] Define live player view content: courts, up-next matches, queue position, sitting out, standings, and recent results.
- [x] Specify tournament workflow and bracket behavior.
  - [x] Confirm MVP tournaments use fixed doubles teams as entrants.
  - [x] Require each team to contain two registered player records.
  - [x] Allow accountless guest and walk-in player records as tournament entrants.
  - [x] Do not require player login accounts for tournament participation.
  - [x] Set team composition before bracket generation.
  - [x] Defer random pairings and singles tournaments.
  - [x] Define supported formats: single elimination, double elimination, and round robin.
  - [x] Define tournament lifecycle statuses: Draft, Registration Open, Registration Closed, Bracket Generated, Live, Completed, Cancelled.
  - [ ] Define seeding rules.
  - [x] Define bye handling.
  - [x] Define match result entry.
  - [ ] Define bracket advancement rules.
  - [ ] Define live public bracket view.
  - [ ] Evaluate whether `brackets-manager.js` and `brackets-viewer.js` should be implementation dependencies or design references only.
- [x] Plan Convex migration and remove Turso/Drizzle.
  - [x] Remove old backend pieces:
    - [x] Remove Turso dependencies from `package.json`.
    - [x] Remove Drizzle dependencies from `package.json`.
    - [x] Remove `drizzle.config.ts`.
    - [x] Remove `drizzle/` migrations after the Convex schema is ready.
    - [x] Remove `TURSO_DB_URL` and `TURSO_DB_TOKEN` from the target architecture.
  - [x] Add Convex backend pieces:
    - [x] Replace `src/lib/db/*` with Convex client/server integration.
    - [x] Add Convex project setup.
    - [x] Add `convex/schema.ts`.
    - [x] Add Convex query and mutation modules for users/auth mapping, Game Master workspaces, venues/clubs, players, open play sessions, session players, session matches, match history, tournaments, tournament entrants, tournament matches, and stats snapshots.
    - [x] Replace SQL server actions with Convex functions.
    - [ ] Replace polling live pages with Convex realtime subscriptions.
    - [ ] Update environment documentation for Convex and WorkOS/AuthKit.
- [x] Review archived prototype and keep only approved concepts.
  - [x] Review `stash@{0}`, the archive branch, and the patch backup for useful ideas only.
  - [x] Keep useful concepts if still aligned with this PRD:
    - [ ] Open play sessions.
    - [ ] QR/live link concept.
    - [ ] Session dashboard shape.
    - [ ] Skill tier constants.
    - [ ] Early matching algorithm ideas.
  - [x] Avoid carryover:
    - [x] Do not keep unapproved schema changes from the prototype.
    - [x] Do not keep Turso, Drizzle, or SQL-based migrations.
    - [x] Do not keep routes that point to missing pages.
    - [x] Rebuild implementation from the PRD after the Convex schema is agreed.
- [x] Validate cleanup and create implementation plan.
  - [x] Confirm `pnpm lint` passes after cleanup and PRD creation.
  - [x] Confirm `pnpm build` passes after cleanup and PRD creation.
  - [x] Confirm `git status` only shows intentional planning-file changes.
  - [x] Create a dedicated implementation plan for the Convex migration before coding.
- [ ] Resolve MVP open questions.
  - [x] Decide whether player accounts are required for MVP participation: they are not required.
  - [x] Decide whether Game Masters can create accountless guest or walk-in records for open plays and tournaments: they can.
  - [x] Decide MVP tournament entrant type: fixed doubles teams with registered player records.
  - [x] Defer random pairing, spin-the-wheel mode, and singles tournaments.
  - [x] Decide whether WorkOS AuthKit is the final auth provider or another Convex-supported provider should be chosen: WorkOS AuthKit is the chosen provider.
  - [ ] Decide whether AI matching should be deferred until rule-based matching has real session history.

## Player Model TODO

- MVP identity decision:
  - No anonymous players in open play or tournaments.
  - Every participant must have a registered player record before they can be checked in, queued, seeded, or added to a match.
  - Game Masters can create local guest or walk-in player records during open play check-in or tournament registration.
  - Guest and walk-in records can be accountless, but they still need enough profile and skill data for matchmaking, seeding, scoring, and history.
  - Player login accounts are not required for MVP participation, but player records should be claimable/linkable to login accounts later.
- Define required player record fields:
  - first name
  - last name
  - owning Game Master workspace or venue
  - skill source: DUPR or manual
  - DUPR rating when skill source is DUPR
  - manual skill level when skill source is manual
- Define optional player fields:
  - username
  - email
  - phone
  - gender
  - avatar/photo
  - emergency notes or private Game Master notes
- Define future player account fields:
  - username
  - email
  - password or external auth identity
- Define manual skill scale:
  - Beginner
  - Novice
  - Low Intermediate
  - High Intermediate
  - Advanced
- Decide whether player identity is global at signup, local per Game Master, or hybrid.
- MVP default: players can be registered locally by a Game Master, with username/email reserved for future cross-Game-Master sync.

## Open Play TODO

- Define open play session statuses:
  - Draft
  - Check-in
  - Live
  - Completed
  - Cancelled
- Define open play session types:
  - Standard Open Play: flexible rotation-focused sessions for recurring club or venue play.
  - Ladder Play: competitive open play where winners move up and losing players or teams move down courts, pools, or standings over successive rounds.
- Define matching modes:
  - Auto-balanced: fair rotation with maximum partner/opponent variety.
  - Skill-separated: group players into comparable skill tiers.
  - Winners vs losers: winners face winners and losers face losers; this can power Ladder Play rounds.
  - Mixed doubles: each team should have one male and one female when enough players are available.
  - Skill courts: run separate queues per skill bracket on dedicated courts.
- Define matching fallback behavior when the ideal mode cannot be satisfied.
- Define how Game Masters can manually adjust generated matches.
- Define how sit-outs rotate fairly.
- Define how winners and scores are recorded.
- Define what stats are shown during and after the session.
- Define live player view content:
  - current courts
  - up-next matches
  - queue position
  - sitting out
  - standings
  - recent results

## Tournament TODO

- MVP tournament entrant decision:
  - Tournaments use fixed doubles teams as entrants.
  - Each team contains two registered player records.
  - Guest and walk-in player records are valid tournament entrants; tournament participation must not require a player login account.
  - Team composition is set before bracket generation.
  - Random pairings are not part of MVP tournament generation.
  - Singles tournament support is deferred.
- Define tournament formats:
  - Single elimination
  - Double elimination
  - Round robin
- Define tournament lifecycle:
  - Draft
  - Registration Open
  - Registration Closed
  - Bracket Generated
  - Live
  - Completed
  - Cancelled
- Define seeding rules.
- Define bye handling.
- Define match result entry.
- Define bracket advancement rules.
- Define live public bracket view.
- Evaluate whether to use `brackets-manager.js` and `brackets-viewer.js` as implementation dependencies or only as design references.

## Future Features TODO

- Random pairing / spin-the-wheel mode:
  - Let Game Masters generate fun randomized doubles pairings for social events.
  - Use registered player records as the source pool.
  - Support quick redraws when a player is unavailable or a pairing should be skipped.
  - Keep this separate from MVP tournament bracket generation, which uses fixed doubles teams.
- Singles tournament support.

## Living Documentation TODO

- Add in-app documentation that can be opened in the browser at `localhost:3000/docs` during development.
- Selected implementation: Fumadocs with MDX content.
- Store docs content in the repository so product and technical decisions stay versioned with the codebase.
- Suggested docs structure:
  - product overview and MVP scope
  - product decisions log
  - player model
  - open play workflow
  - matching logic
  - tournament workflow
  - Convex data model
  - authentication and account linking
- Initial docs can be public in development. Decide later whether production docs should be hidden, admin-only, or deployed separately.

## Convex Migration TODO

- Remove Turso dependencies from `package.json`.
- Remove Drizzle dependencies from `package.json`.
- Remove `drizzle.config.ts`.
- Remove the `drizzle/` migrations directory after the Convex schema is ready.
- Replace `src/lib/db/*` with Convex client/server integration.
- Add Convex project setup.
- Add `convex/schema.ts`.
- Add Convex query and mutation modules for:
  - users/auth identity mapping
  - Game Master workspaces
  - venues/clubs
  - players
  - open play sessions
  - session players
  - session matches
  - match history
  - tournaments
  - tournament entrants
  - tournament matches
  - stats snapshots
- Replace SQL server actions with Convex functions.
- Replace polling live pages with Convex realtime subscriptions.
- Update environment documentation for Convex and WorkOS/AuthKit.

## Cleanup TODO

- Review the archived prototype for useful ideas only.
- Keep useful product concepts:
  - open play sessions
  - QR/live link concept
  - session dashboard shape
  - skill tier constants
  - early matching algorithm ideas
- Do not directly keep unapproved schema changes from the prototype.
- Do not keep Turso, Drizzle, or SQL-based migrations.
- Do not keep routes that point to missing pages.
- Rebuild the implementation from this PRD after the Convex schema is agreed.

## Validation TODO

- Confirm `pnpm lint` passes after cleanup and PRD creation.
- Confirm `pnpm build` passes after cleanup and PRD creation.
- Confirm `git status` only shows intentional planning-file changes.
- Before implementation, create a dedicated implementation plan for the Convex migration.

## Open Questions

- Answered: All participants must be registered as player records. Player login accounts are not required for MVP participation; Game Masters can register accountless guest or walk-in players locally during open play check-in or tournament registration.
- Answered: MVP tournaments use fixed doubles teams as entrants. Random pairing / spin-the-wheel mode and singles tournaments are future features.
- Should WorkOS AuthKit be the final auth provider, or should another Convex-supported provider be chosen before implementation?
- Should AI matching be deferred until rule-based matching has real session history?
