---
title: Agent README
description: Context for AI agents updating Pickle Point docs.
---

# Pickle Point Docs

This folder is the living documentation source for Pickle Point. Fumadocs serves these files at `/docs`.

## Source Of Truth

Use this order when sources disagree:

1. Current repo implementation and tests.
2. `docs/task-log/`.
3. `PRD-NEW.md`.
4. Imported ClickUp task status.

ClickUp is retired as the active task system. Imported ClickUp links and statuses are provenance only; future task status belongs in `docs/task-log/`.

## How Docs Work

- Fumadocs reads this directory through `source.config.ts`.
- Keep MDX files flat in `docs/` by default.
- Add a subfolder only when a topic is expected to have many MDX pages.
- Add every served MDX page to `docs/meta.json`.
- Keep `docs/task-log/` as the canonical task queue and status history.
- Keep `docs/decisions-log.mdx` as the canonical decision log.

## Updating Docs

Update docs when changing:

- Task status, scope, acceptance criteria, validation evidence, or follow-up work.
- Product scope or roadmap.
- Feature behavior.
- Technical architecture.
- Convex schema, functions, or auth flow.
- Validation rules or acceptance criteria.

For Convex code changes, read `convex/_generated/ai/guidelines.md` before editing.

## Branch Naming

Task branches must use one of these prefixes:

- `feat/`
- `minor/`
- `chore/`
- `fix/`
- `hotfix/`

Do not create branches with other prefixes such as `task/`.

## Validation

For documentation-only changes, run:

```bash
pnpm lint
pnpm build
```

For feature changes, run:

```bash
pnpm test
pnpm lint
pnpm build
```

## Current Product Context

Pickle Point is a realtime pickleball operations app for Game Masters who run open plays and small tournaments.

The MVP uses Convex for persistence, backend functions, and realtime sync. WorkOS AuthKit handles Game Master authentication. Players do not need login accounts for MVP participation, but every participant must have a player record.
