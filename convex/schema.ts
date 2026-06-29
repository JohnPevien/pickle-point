import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // 1. Tenants (Game Master workspaces/venues)
  //
  // Phase 1 widening (migration-safe):
  // - `slug`, `timezone`, `workosOrganizationId`, `status` are all
  //   OPTIONAL during widening; legacy documents without them remain
  //   valid. They become required in a later phase after backfill
  //   confirms all rows are populated.
  // - Legacy `contactEmail` is retained. The legacy `name` field is
  //   retained and `name` continues to be the only required display
  //   field for the basic public listing until the widening-narrowing
  //   migration completes.
  tenants: defineTable({
    name: v.string(),
    contactEmail: v.string(),
    // Required-by-Phase-1.4-once-bootstrapped fields — optional here so
    // pre-Phase-1.4 documents continue to validate.
    slug: v.optional(v.string()),
    timezone: v.optional(v.string()),
    workosOrganizationId: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("disabled"))),
    logoUrl: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_contactEmail", ["contactEmail"])
    .index("by_slug", ["slug"])
    .index("by_workosOrganizationId", ["workosOrganizationId"]),

  // 2. User identity (global, not tenant-scoped)
  //
  // Phase 1 widening (migration-safe):
  // - `workosUserId`, `emailNormalized`, `lastSeenAt`, `fullName` are
  //   OPTIONAL during widening; legacy `name` field is restored.
  // - Legacy `tenantId` field is retained; authorization code reads
  //   `tenantMemberships`, not this field.
  // Identity linkage: tokenIdentifier is the canonical key; email is
  // normalized for diagnostic lookup only and never grants authority.
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    // Legacy optional `name` retained so pre-Phase-1 documents without
    // `fullName` still validate. New writes prefer `fullName`.
    name: v.optional(v.string()),
    // Phase 1.3 widening fields — optional during widening.
    workosUserId: v.optional(v.string()),
    emailNormalized: v.optional(v.string()),
    fullName: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
    tenantId: v.id("tenants"), // legacy transitional field; do not use for authorization
    createdAt: v.number(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_workosUserId", ["workosUserId"])
    .index("by_emailNormalized", ["emailNormalized"])
    // Phase 1.5: indexed by legacy `tenantId` so the bounded backfill
    // migration advances a cursor instead of re-reading the same
    // first batch forever. Convex auto-appends `_creationTime` to the
    // end of every index, so ordering by (tenantId, _creationTime)
    // is available from a single-column `by_tenantId` index and a
    // timestamp watermark gives deterministic pagination.
    .index("by_tenantId", ["tenantId"]),

  // 3. Tenant memberships (one row per user/tenant pair)
  //
  // Authorization decisions read this table. Phase 1 records the
  // membership role locally; Phase 2 reconciles the role from
  // WorkOS organization claims and rejects administrative elevation
  // when the trusted claims no longer grant it.
  // `status: "active" | "suspended"` is the local Convex gate.
  // `workosOrganizationMembershipId` links the row to the WorkOS
  // admin-org membership record (used for idempotent webhook handling).
  tenantMemberships: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("game_master"),
      v.literal("player")
    ),
    status: v.union(v.literal("active"), v.literal("suspended")),
    workosOrganizationMembershipId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_userId", ["tenantId", "userId"])
    .index("by_workosOrganizationMembershipId", [
      "workosOrganizationMembershipId",
    ]),

  // 4. Audit log — safe before/after metadata only.
  // Captures administrative membership reconciliation, event lifecycle
  // changes, manual check-in reversal, match cancellation/substitution,
  // score creation/correction, and tenant setting changes.
  auditLogs: defineTable({
    tenantId: v.id("tenants"),
    actorUserId: v.optional(v.id("users")),
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    before: v.optional(v.string()), // JSON-stringified safe snapshot
    after: v.optional(v.string()),  // JSON-stringified safe snapshot
    createdAt: v.number(),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_createdAt", ["tenantId", "createdAt"]),

  // 5. WorkOS webhook receipts — idempotency guard.
  // One row per WorkOS event id; `by_eventId` is the dedupe index.
  // Phase 2 wires the HTTP route to consult this table before applying.
  workosWebhookReceipts: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    status: v.union(
      v.literal("received"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    attempts: v.number(),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_eventId", ["eventId"])
    .index("by_status", ["status"]),

  // 6. Venues / Clubs
  venues: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    address: v.optional(v.string()),
    courtCount: v.number(),
    createdAt: v.number(),
  }).index("by_tenant", ["tenantId"]),

  // 7. Unified Players Directory (No anonymous players)
  players: defineTable({
    tenantId: v.id("tenants"),
    firstName: v.string(),
    lastName: v.string(),
    skillSource: v.union(v.literal("manual"), v.literal("dupr")),
    duprRating: v.optional(v.float64()),
    manualSkillLevel: v.union(
      v.literal("Beginner"),
      v.literal("Novice"),
      v.literal("Low Intermediate"),
      v.literal("High Intermediate"),
      v.literal("Advanced")
    ),
    // Optional contact details & profile info
    username: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    gender: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    notes: v.optional(v.string()), // Emergency or private GM notes
    optIn: v.optional(v.boolean()), // Consent flag
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenantId_and_email", ["tenantId", "email"])
    .index("by_tenantId_and_phone", ["tenantId", "phone"]),

  // 8. Open Play Sessions
  openPlaySessions: defineTable({
    tenantId: v.id("tenants"),
    venueId: v.optional(v.id("venues")),
    name: v.string(),
    date: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("check_in"),
      v.literal("live"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    matchingMode: v.union(
      v.literal("auto_balanced"),
      v.literal("skill_separated"),
      v.literal("winners_vs_losers"),
      v.literal("mixed_doubles"),
      v.literal("skill_courts")
    ),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_venueId", ["venueId"]),

  // 9. Session Players (Queue & Check-in tracking)
  sessionPlayers: defineTable({
    sessionId: v.id("openPlaySessions"),
    playerId: v.id("players"),
    status: v.union(
      v.literal("checked_in"),
      v.literal("queued"),
      v.literal("playing"),
      v.literal("sitting_out"),
      v.literal("paused"),
      v.literal("left")
    ),
    queuePosition: v.optional(v.number()),
    checkedInAt: v.number(),
    matchesPlayed: v.optional(v.number()),
    sitOutCount: v.optional(v.number()),
    consecutiveSitOuts: v.optional(v.number()),
    lastPlayedAt: v.optional(v.number()),
    lastSatOutAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_playerId", ["playerId"])
    .index("by_sessionId_and_playerId", ["sessionId", "playerId"])
    .index("by_sessionId_and_status", ["sessionId", "status"])
    .index("by_sessionId_and_status_and_queuePosition", ["sessionId", "status", "queuePosition"]),

  // 10. Session Queue Counters (append-only queue position allocation)
  sessionQueueCounters: defineTable({
    sessionId: v.id("openPlaySessions"),
    nextPosition: v.number(),
    frontNextPosition: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_sessionId", ["sessionId"]),

  // 11. Session Matches
  sessionMatches: defineTable({
    sessionId: v.id("openPlaySessions"),
    courtName: v.optional(v.string()),
    team1: v.array(v.id("players")),
    team2: v.array(v.id("players")),
    score1: v.optional(v.number()),
    score2: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_sessionId_and_status", ["sessionId", "status"]),

  // 12. Match History
  matchHistory: defineTable({
    tenantId: v.id("tenants"),
    sessionId: v.optional(v.id("openPlaySessions")),
    tournamentId: v.optional(v.id("tournaments")),
    players: v.array(v.id("players")),
    scores: v.array(v.number()),
    winners: v.array(v.id("players")),
    playedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_player", ["players"]),

  // 13. Tournaments
  tournaments: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    date: v.number(),
    location: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("registration_open"),
      v.literal("registration_closed"),
      v.literal("bracket_generated"),
      v.literal("live"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    format: v.union(
      v.literal("single_elimination"),
      v.literal("double_elimination"),
      v.literal("round_robin")
    ),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenantId_and_status", ["tenantId", "status"]),

  // 14. Tournament Entrants
  tournamentEntrants: defineTable({
    tournamentId: v.id("tournaments"),
    name: v.string(),
    player1Id: v.id("players"),
    player2Id: v.id("players"),
    skillTier: v.union(
      v.literal("Beginner"),
      v.literal("Novice"),
      v.literal("Low Intermediate"),
      v.literal("High Intermediate"),
      v.literal("Advanced")
    ),
    seed: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_player1Id", ["player1Id"])
    .index("by_player2Id", ["player2Id"])
    .index("by_tournamentId_and_player1Id", ["tournamentId", "player1Id"])
    .index("by_tournamentId_and_player2Id", ["tournamentId", "player2Id"])
    .index("by_tournamentId_and_player1Id_and_player2Id", [
      "tournamentId",
      "player1Id",
      "player2Id",
    ]),

  // 15. Tournament Matches
  tournamentMatches: defineTable({
    tournamentId: v.id("tournaments"),
    entrant1Id: v.optional(v.id("tournamentEntrants")),
    entrant2Id: v.optional(v.id("tournamentEntrants")),
    courtName: v.optional(v.string()),
    score1: v.optional(v.number()),
    score2: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed")
    ),
    roundNumber: v.number(),
    matchOrder: v.number(),
    winnerId: v.optional(v.id("tournamentEntrants")),
    skillTier: v.optional(v.union(
      v.literal("Beginner"),
      v.literal("Novice"),
      v.literal("Low Intermediate"),
      v.literal("High Intermediate"),
      v.literal("Advanced")
    )),
    bracketStage: v.optional(v.union(
      v.literal("round_robin"),
      v.literal("single_elimination"),
      v.literal("winners"),
      v.literal("losers"),
      v.literal("grand_final")
    )),
    entrant1SourceMatchId: v.optional(v.id("tournamentMatches")),
    entrant1SourceOutcome: v.optional(v.union(v.literal("winner"), v.literal("loser"))),
    entrant2SourceMatchId: v.optional(v.id("tournamentMatches")),
    entrant2SourceOutcome: v.optional(v.union(v.literal("winner"), v.literal("loser"))),
    isIfNecessary: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_tournamentId_and_roundNumber", ["tournamentId", "roundNumber"]),

  // 16. Player Stats Snapshots
  statsSnapshots: defineTable({
    tenantId: v.id("tenants"),
    playerId: v.id("players"),
    wins: v.number(),
    losses: v.number(),
    pointsFor: v.number(),
    pointsAgainst: v.number(),
    snapshotDate: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenantId_and_snapshotDate", ["tenantId", "snapshotDate"])
    .index("by_player", ["playerId"])
    .index("by_playerId_and_snapshotDate", ["playerId", "snapshotDate"]),
});