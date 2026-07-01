---
title: Match History Participant Backfill Plan
description: Phase 3.2 data backfill for participants
---

# Match History Participant Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, resumable, idempotent Convex migration that creates missing `matchHistoryParticipants` rows for legacy match history.

**Architecture:** A tenant-scoped internal mutation paginates the existing `matchHistory.by_tenant` index. For each match in the bounded page, it loads existing reference rows through `matchHistoryParticipants.by_matchHistoryId`, computes missing distinct players, and either reports or inserts those rows. The existing score-recording mutation remains the dual-write path for new data.

**Tech Stack:** TypeScript, Convex internal mutations, Convex pagination, convex-test, Vitest.

---

### Task 1: Add failing migration coverage

**Files:**
- Create: `convex/matchHistoryParticipants.migration.test.ts`

- [x] **Step 1: Create typed test fixtures**

Create helpers for a tenant, WorkOS owner identity and membership, players, and legacy match-history rows. Reference the not-yet-created function through `(internal as any).migrations.matchHistoryParticipants.backfillTenant` so tests do not require generated API edits.

- [x] **Step 2: Add behavior tests**

Cover these exact cases:

```ts
test("dry-run reports missing references without writing them", async () => {});
test("backfills multiple bounded pages and is idempotent", async () => {});
test("repairs a partially populated match and deduplicates player ids", async () => {});
test("never processes another tenant's matches", async () => {});
test("makes deletePlayer reject a player referenced only by legacy history", async () => {});
test("rejects a missing tenant", async () => {});
```

- [x] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
node_modules/.bin/vitest run convex/matchHistoryParticipants.migration.test.ts
```

Expected: failures because `migrations/matchHistoryParticipants:backfillTenant` does not exist.

### Task 2: Implement the bounded backfill

**Files:**
- Create: `convex/migrations/matchHistoryParticipants.ts`

- [x] **Step 1: Define the internal mutation contract**

Use validators for:

```ts
{
  tenantId: v.id("tenants"),
  cursor: v.optional(v.union(v.string(), v.null())),
  batchSize: v.optional(v.number()),
  dryRun: v.optional(v.boolean()),
}
```

Return:

```ts
{
  matchesScanned: number;
  referencesCreated: number;
  referencesMissing: number;
  isDone: boolean;
  cursor: string;
}
```

- [x] **Step 2: Implement one bounded page**

Validate the tenant, clamp `batchSize` with `finiteInt` to `1..100` with a default of `50`, and paginate only:

```ts
ctx.db
  .query("matchHistory")
  .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
  .order("asc")
  .paginate({ numItems: batchSize, cursor: args.cursor ?? null });
```

For each match, deduplicate `match.players`, load at most 64 existing rows through `by_matchHistoryId`, and insert only missing player references. In dry-run mode, increment `referencesMissing` but do not insert. Reject a source match with more than 64 distinct players so one malformed row cannot exceed transaction limits.

- [x] **Step 3: Run focused tests and confirm GREEN**

Run:

```bash
node_modules/.bin/vitest run convex/matchHistoryParticipants.migration.test.ts convex/players.test.ts
```

Expected: all migration and player tests pass.

### Task 3: Classify and document the internal migration

**Files:**
- Modify: `docs/security/convex-access-matrix.md`
- Modify: `docs/superpowers/specs/2026-07-01-match-history-participant-backfill-design.md`

- [x] **Step 1: Add the access-matrix row**

Add `migrations/matchHistoryParticipants.backfillTenant` as an operator-invoked internal mutation. Document its explicit tenant scope, bounded cursor, dry-run support, idempotence, and absence of public return data.

- [x] **Step 2: Record implementation status**

Update the design spec from future tense to completed local implementation while retaining the statement that no live migration was executed.

- [x] **Step 3: Run the inventory check**

Run:

```bash
node scripts/check-convex-access.mjs
```

Expected: every registered Convex function is classified.

### Task 4: Full verification

**Files:**
- Verify all changed files; do not commit.

- [x] **Step 1: Run all tests**

```bash
node_modules/.bin/vitest run
```

- [x] **Step 2: Run lint and TypeScript checks**

```bash
node_modules/.bin/eslint convex/migrations/matchHistoryParticipants.ts convex/matchHistoryParticipants.migration.test.ts
node_modules/.bin/tsc --noEmit --pretty false
```

Report unrelated pre-existing TypeScript failures separately; the new migration files must introduce none.

- [x] **Step 3: Run repository gates**

```bash
node scripts/check-convex-access.mjs
git diff --check
```

- [x] **Step 4: Inspect the final diff**

Confirm the migration is bounded, tenant-scoped, resumable, idempotent, dry-run capable, and not deployed or executed.
