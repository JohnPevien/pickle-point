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

## Player Model TODO

- MVP identity decision:
  - No anonymous players in open play or tournaments.
  - Every participant must have a registered player record before they can be checked in, queued, seeded, or added to a match.
  - Game Masters can create local player records for walk-ins during check-in.
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
- Define matching modes:
  - Auto-balanced: fair rotation with maximum partner/opponent variety.
  - Skill-separated: group players into comparable skill tiers.
  - Winners vs losers: winners face winners and losers face losers in ladder style.
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

- Answered: All participants must be registered as player records. Player login accounts are not required for MVP participation; Game Masters can register walk-ins locally during check-in.
- Answered: MVP tournaments use fixed doubles teams as entrants. Random pairing / spin-the-wheel mode and singles tournaments are future features.
- Should WorkOS AuthKit be the final auth provider, or should another Convex-supported provider be chosen before implementation?
- Should AI matching be deferred until rule-based matching has real session history?
