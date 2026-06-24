# Pickle Point PRD + Cleanup TODO

## Current Implementation Status

As of 2026-06-22, current repo implementation and tests supersede stale unchecked items in this historical PRD checklist. Use this priority when sources disagree:

1. Current repo implementation and tests.
2. `docs/task-log/`.
3. This PRD.
4. Imported ClickUp status.

The MVP feature set is implemented enough for release-readiness polish: Convex backend, WorkOS AuthKit, workspace setup, venues, player directory, Open Play control/live views, fair rotation, manual match adjustment, tournaments, public bracket views, QR support, and browser-openable docs all exist in the repo.

Remaining MVP readiness work is tracked in `docs/task-log/pp-030-mvp-readiness-and-release-polish.mdx`.

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
- [x] Phase 2 — Auth: WorkOS AuthKit installed, Convex auth config wired, layout-based guard protecting admin routes.
- [x] Phase 3 — UI: Open Play session screens, live views, manual adjustment controls, fair rotation, tournament screens, workspace settings, venue management, player directory, and admin navigation are implemented.

Phase 3 progress:

- [x] Open Play Game Master control route at `/[tenant]/admin/open-play`.
- [x] Open Play session creation UI.
- [x] Player directory check-in UI.
- [x] Accountless walk-in check-in UI.
- [x] Session status and matching-mode controls.
- [x] Generate matches from the Game Master control screen.
- [x] Session score entry from the Game Master control screen.
- [x] Live player view route at `/[tenant]/open-play/[sessionId]`.
- [x] Live player view content: courts, up-next queue, sitting out, standings, and recent results.
- [x] Copyable live player link from the Game Master control screen.
- [x] Open Play UI helper coverage added; `pnpm test`, `pnpm lint`, and `pnpm build` passing after review fixes.
- [x] QR code generation for live player links.
  - [x] Choose QR implementation approach that works in the current Next.js client/server setup.
  - [x] Render QR code in the Game Master control screen for the selected session.
  - [x] Add a print-friendly or display-friendly QR layout for courtside use.
  - [x] Add tests or smoke coverage for live-link URL generation.
- [x] Manual adjustment controls for generated matches.
  - [x] Define allowed manual edits: rename court, swap players, substitute with queued/sitting-out player, and cancel an unscored match.
  - [x] Add backend mutation(s) for editing pending/in-progress session matches with tenant/session validation.
  - [x] Add UI controls for swapping players, substituting players, renaming courts, and cancelling unscored matches without losing queue state.
  - [x] Add validation and tests for duplicate players, missing players, active-player conflicts, and completed/scored-match restrictions.
  - [x] Add regenerate-only-empty-courts controls if needed after fair-rotation rules are finalized. Decision: no separate control is needed because Generate Matches already fills only unoccupied courts.
- [x] Fair sit-out rotation rules and controls.
  - [x] Define fairness metric: wait count, last played time, consecutive sits, or queue position only.
  - [x] Decide whether winners/losers returning to queue should affect sit-out priority.
  - [x] Persist any needed rotation metadata if queue position is not enough.
  - [x] Add visible wait/sit-out state to the Game Master control screen.
  - [x] Add backend tests for the chosen rotation rule.
- [x] Tournament bracket live/admin UI screens.
  - [x] Add tournament creation and status-management UI.
  - [x] Add Game Master bracket control route for generated brackets.
  - [x] Add tournament score-entry UI backed by `recordTournamentScore`.
  - [x] Add public live bracket route for players/spectators.
  - [x] Add bracket helper tests for grouping, status labels, public URL generation, and winner display.
- [x] Remaining admin screens for workspace, venue, player directory, and tournament management.
  - [x] Workspace setup/edit screen for Game Master account bootstrap.
  - [x] Venue/club profile screen with court count and branding fields.
  - [x] Player directory CRUD screen with manual/DUPR rating fields.
  - [x] Tournament list/detail management screens.
  - [x] Admin navigation that links dashboard, open play, players, venues, and tournaments.

## Testing Policy

Every feature must ship with tests. No backend function, UI component, or auth flow should be merged without a corresponding test.

- Use vitest with convex-test for all Convex query and mutation functions.
- New Convex modules must include a `*.test.ts` file in the `convex/` directory covering the happy path and key error cases.
- UI components that contain business logic should have unit or integration tests.
- `pnpm test` must pass before any phase is considered complete.

- [x] Maintain test coverage as new Convex modules are added.
- [x] Expand WorkOS test coverage beyond env validation/route constants to cover auth routes and `authkitProxy` wiring.
- [x] Add tests for UI helper and business logic introduced during Phase 3.

## ClickUp Delivery Checklist

Source: active ClickUp tasks in the Pickle Point list.

- [x] Finalize product direction and MVP scope.
  - [x] Confirm Pickle Point as a realtime pickleball operations app for Game Masters.
  - [x] Keep open play as the primary workflow.
  - [x] Include mini tournaments in the MVP.
  - [x] Confirm the core MVP feature set:
    - [ ] Game Master account and workspace setup.
      - [ ] First-run workspace creation flow after auth sign-in.
      - [ ] Workspace owner mapping to WorkOS/Convex user identity.
      - [ ] Workspace settings screen for name, contact email, and branding.
    - [ ] Venue or club profile.
      - [ ] Venue creation/edit form.
      - [ ] Court count management used by Open Play match generation.
      - [ ] Optional venue address/contact fields.
    - [x] Player directory.
    - [x] Accountless guest and walk-in player records.
    - [x] Manual skill ratings.
    - [x] Optional DUPR ratings.
    - [x] Open play sessions (backend and first admin UI slice complete).
    - [x] Smart matching (backend and Game Master generation UI complete).
    - [x] Live links and QR codes.
      - [x] Copyable Open Play live link.
      - [x] QR code for Open Play live link.
      - [x] QR/live-link equivalent for tournaments.
    - [x] Session stats (backend and live leaderboard/recent results UI complete).
    - [x] Mini tournaments (backend and first admin/public UI complete).
    - [x] Live bracket views (backend and public/admin UI complete).
    - [x] Game Master controls (Open Play and tournament control screens complete; workspace/venue/player management controls pending).
      - [x] Open Play control screen.
      - [x] Manual match adjustment controls.
      - [x] Tournament bracket control screen.
      - [ ] Workspace/venue/player management screens.
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
    - [x] Owning Game Master workspace.
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
  - [x] Define future player account fields:
    - [x] Username.
    - [x] Email.
    - [x] External auth identity.
  - [x] Define the manual skill scale: Beginner, Novice, Low Intermediate, High Intermediate, Advanced.
  - [x] Decide whether long-term player identity is global at signup, local per Game Master, or hybrid.
    - [x] Choose hybrid identity: local player records remain scoped to one Game Master workspace for MVP, with future account claim/link support.
    - [x] Decide claim/link flow for existing local player records: future login accounts may claim or link local records.
    - [x] Decide duplicate handling when the same player appears in multiple Game Master workspaces: no cross-workspace auto-merge in MVP.
    - [x] Document chosen identity model in `/docs`.
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
  - [x] Define Game Master manual adjustment controls for generated matches.
    - [x] Define which edits are allowed before score entry: rename court, swap players, substitute queued/sitting-out players, and cancel an unscored match.
    - [x] Define which edits are allowed once a match is in progress: court rename and player swaps remain available; substitutions and cancellation are blocked after scoring.
    - [x] Define how adjusted players return to queue after score entry or cancellation.
    - [x] Define audit/history expectations for manually adjusted matches.
  - [ ] Define fair sit-out rotation.
    - [ ] Define whether fairness is player-based or team-based.
    - [ ] Define how queue position, last played time, and consecutive sit-outs interact.
    - [ ] Define exception behavior when there are not enough players for ideal rotation.
    - [ ] Define what fairness info Game Masters and players can see.
  - [x] Define winner and score recording.
  - [x] Define stats shown during and after sessions.
  - [x] Define live player view content: courts, up-next matches, queue position, sitting out, standings, and recent results.
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
    - [ ] Decide default seed order: manual seed, skill rating, registration order, or random.
    - [ ] Decide whether seeding is per skill tier or whole tournament.
    - [ ] Define tie-break behavior when seed inputs are missing or equal.
    - [ ] Add seed editing UI requirements.
  - [x] Define bye handling.
  - [x] Define match result entry.
  - [ ] Define bracket advancement rules.
    - [ ] Confirm single-elimination winner advancement behavior.
    - [ ] Confirm double-elimination loser bracket and grand-final reset behavior.
    - [ ] Confirm round-robin standings and tie-break behavior.
    - [ ] Define how edited/corrected scores affect downstream matches.
  - [x] Define live public bracket view.
    - [x] Define public route shape and tenant/tournament lookup: `/[tenant]/tournaments/[tournamentId]`.
    - [x] Define bracket grouping by tier, stage, and round.
    - [x] Define mobile layout for player/spectator viewing.
    - [x] Define which result details are public.
  - [x] Evaluate whether `brackets-manager.js` and `brackets-viewer.js` should be implementation dependencies or design references only.
    - [x] Decide MVP dependency stance: reference only.
    - [x] Keep tournament state in Convex tables for teams, matches, scores, and bracket status.
    - [x] Document final dependency/reference decision.
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
    - [x] Replace polling live pages with Convex realtime subscriptions for the Open Play control and live views.
    - [x] Update environment documentation for Convex and WorkOS/AuthKit.
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
- [x] Resolve MVP open questions.
  - [x] Decide whether player accounts are required for MVP participation: they are not required.
  - [x] Decide whether Game Masters can create accountless guest or walk-in records for open plays and tournaments: they can.
  - [x] Decide MVP tournament entrant type: fixed doubles teams with registered player records.
  - [x] Defer random pairing, spin-the-wheel mode, and singles tournaments.
  - [x] Decide whether WorkOS AuthKit is the final auth provider or another Convex-supported provider should be chosen: WorkOS AuthKit is the chosen provider.
  - [x] Decide whether AI matching should be deferred until rule-based matching has real session history.
    - [x] Define minimum session-history threshold before revisiting AI matching: at least 10 completed sessions and 100 scored matches in a workspace.
    - [x] Identify matching quality metrics to compare rule-based vs AI-assisted matching: repeat-partner rate, repeat-opponent rate, wait fairness, skill spread, and Game Master override rate.
    - [x] Keep Game Master override visibility as the required control signal before introducing AI suggestions.

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
  - owning Game Master workspace
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
  - external auth identity
- Define manual skill scale:
  - Beginner
  - Novice
  - Low Intermediate
  - High Intermediate
  - Advanced
- MVP identity model is hybrid:
  - Player records are local to one Game Master workspace for MVP.
  - Future login accounts may claim or link existing local accountless records.
  - Duplicate player records across Game Master workspaces are not auto-merged in MVP.
  - Username, email, and external auth identity are reserved for future player accounts.

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
  - Allow swapping partners before score entry.
  - Allow changing court assignment before or during a match.
  - Allow cancelling or clearing an unscored generated match.
  - Prevent duplicate active assignments for the same player.
  - Preserve queue state when a match is manually changed.
- Define how sit-outs rotate fairly.
  - Decide whether fairness uses queue position only or also wait count/last played time.
  - Decide how winners and losers return to the queue after scoring.
  - Decide whether Game Masters can manually mark a player as sitting out.
  - Surface fairness indicators to the Game Master and live player view if useful.
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
  - Decide default seeding source: manual, skill rating, registration order, or random.
  - Define whether seeds are per skill tier or tournament-wide.
  - Define duplicate/missing seed validation.
  - Add Game Master seed editing requirements.
- Define bye handling.
- Define match result entry.
- Define bracket advancement rules.
  - Confirm single-elimination advancement.
  - Confirm double-elimination loser bracket and grand-final reset behavior.
  - Confirm round-robin standings and tie-breakers.
  - Define score correction behavior after downstream advancement.
- Define live public bracket view.
  - Define public route and access model.
  - Define round/stage/tier grouping.
  - Define mobile-first bracket layout.
  - Define which player/team/result details are visible publicly.
- Use `brackets-manager.js` and `brackets-viewer.js` as reference-only material for MVP.
  - Keep tournament teams, matches, scores, and bracket status in Convex.
  - Revisit library adoption later only if the in-house bracket workflow cannot cover needed formats or maintenance cost becomes too high.

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
- Answered: MVP player identity is hybrid. Player records are local to a Game Master workspace for MVP, future login accounts may claim or link local records, and duplicate records are not auto-merged across workspaces.
- Answered: MVP tournaments use fixed doubles teams as entrants. Random pairing / spin-the-wheel mode and singles tournaments are future features.
- Answered: WorkOS AuthKit is the chosen MVP Game Master auth provider.
- Answered: AI matching is deferred until a workspace has at least 10 completed sessions and 100 scored matches, then evaluated with repeat-partner rate, repeat-opponent rate, wait fairness, skill spread, and Game Master override rate.
