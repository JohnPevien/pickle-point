import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // 1. Tenants (Game Master workspaces/venues)
  tenants: defineTable({
    name: v.string(),
    logoUrl: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    contactEmail: v.string(),
    createdAt: v.number(),
  }).index("by_contactEmail", ["contactEmail"]),

  // 2. User/Game Master Auth Identity Mapping
  users: defineTable({
    tokenIdentifier: v.string(), // WorkOS user identity string
    tenantId: v.id("tenants"),    // Owning Game Master workspace
    email: v.string(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  // 3. Venues / Clubs
  venues: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    address: v.optional(v.string()),
    courtCount: v.number(),
    createdAt: v.number(),
  }).index("by_tenant", ["tenantId"]),

  // 4. Unified Players Directory (No anonymous players)
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

  // 5. Open Play Sessions
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
  }).index("by_tenant", ["tenantId"]),

  // 6. Session Players (Queue & Check-in tracking)
  sessionPlayers: defineTable({
    sessionId: v.id("openPlaySessions"),
    playerId: v.id("players"),
    status: v.union(
      v.literal("checked_in"),
      v.literal("queued"),
      v.literal("playing"),
      v.literal("sitting_out"),
      v.literal("left")
    ),
    queuePosition: v.optional(v.number()),
    checkedInAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_sessionId_and_playerId", ["sessionId", "playerId"])
    .index("by_sessionId_and_status", ["sessionId", "status"]),

  // 7. Session Matches (Live courts match manager for Open Play)
  sessionMatches: defineTable({
    sessionId: v.id("openPlaySessions"),
    courtName: v.optional(v.string()),
    team1: v.array(v.id("players")), // Array of 1 or 2 player IDs
    team2: v.array(v.id("players")), // Array of 1 or 2 player IDs
    score1: v.optional(v.number()),
    score2: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed")
    ),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_session", ["sessionId"]),

  // 8. Match History (Consolidated historical game records)
  matchHistory: defineTable({
    tenantId: v.id("tenants"),
    sessionId: v.optional(v.id("openPlaySessions")),
    tournamentId: v.optional(v.id("tournaments")),
    players: v.array(v.id("players")), // Flat list of all 2 or 4 players
    scores: v.array(v.number()),        // Match scores (length corresponds to teams)
    winners: v.array(v.id("players")),  // Winning player IDs
    playedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_player", ["players"]),

  // 9. Tournaments
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

  // 10. Tournament Entrants (Fixed Doubles Teams)
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
    .index("by_tournamentId_and_player1Id", ["tournamentId", "player1Id"])
    .index("by_tournamentId_and_player2Id", ["tournamentId", "player2Id"])
    .index("by_tournamentId_and_player1Id_and_player2Id", ["tournamentId", "player1Id", "player2Id"]),

  // 11. Tournament Matches (The bracket structure)
  tournamentMatches: defineTable({
    tournamentId: v.id("tournaments"),
    entrant1Id: v.optional(v.id("tournamentEntrants")), // optional for Byes or TBDs
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
    createdAt: v.number(),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_tournamentId_and_roundNumber", ["tournamentId", "roundNumber"]),

  // 12. Player Stats Snapshots
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
    .index("by_player", ["playerId"]),
});
