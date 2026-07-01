---
title: Match History Participant Backfill Design
description: Phase 3.2 design document for match participants
---

# Match History Participant Backfill Design

## Goal

Backfill `matchHistoryParticipants` for legacy `matchHistory` documents so
`players.deletePlayer` can rely exclusively on its bounded, index-backed
participant lookup without overlooking matches created before dual writes were
introduced.

The migration is implemented and tested in this working tree, but it has not
been deployed or executed against a live Convex environment.

## Approach

Add a tenant-scoped internal mutation under `convex/migrations/`. It processes
one bounded page of `matchHistory` documents ordered by the existing
`by_tenant` index and accepts Convex's opaque pagination cursor for resumption.
The response reports the number of matches inspected, participant rows created,
whether more data remains, and the next cursor.

Each source match contributes at most one reference per distinct player ID.
Before inserting, the migration reads the existing references through
`by_matchHistoryId`, then inserts only missing `(matchHistoryId, playerId)`
pairs. This makes retries and partially completed migrations idempotent.

The batch size is clamped to a conservative maximum. A dry-run option performs
all reads and reports the writes it would make without changing data.

## Data Integrity

- The caller must provide an existing tenant ID.
- Only `matchHistory` rows belonging to that tenant are processed.
- Reference rows copy `tenantId` from the source match, never from an unrelated
  caller-controlled value.
- Duplicate player IDs within a source match are collapsed.
- Existing participant rows are preserved.
- New match writes continue creating participant rows transactionally, so data
  created during or after the backfill is already in the new format.

## Operational Flow

1. Deploy the widened schema, dual-write path, and migration function.
2. Invoke the migration internally for the target tenant with `dryRun: true`.
3. Review the returned counts.
4. Invoke it repeatedly with the returned cursor until `isDone` is true.
5. Re-run from a null cursor to verify that zero rows are created.

Live deployment and execution are intentionally outside this task.

## Tests

Convex tests will prove that the migration:

- backfills legacy matches and makes player deletion fail safely;
- advances through multiple bounded batches;
- is idempotent when rerun;
- repairs partially populated participant references;
- never crosses tenant boundaries;
- reports dry-run counts without writing rows; and
- rejects a missing tenant.

The focused migration/player tests and the full repository test suite will be
run after implementation. Type checking, linting, the Convex access check, and
`git diff --check` remain part of the final verification gate.
