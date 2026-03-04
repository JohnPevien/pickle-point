import { sql } from "drizzle-orm";
import { text, integer, sqliteTable } from "drizzle-orm/sqlite-core";

// 1. Tenants (Game Masters)
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(), // ULID or UUID
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").default("#000000"),
  secondaryColor: text("secondary_color").default("#ffffff"),
  contactEmail: text("contact_email").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// 2. Tournaments
export const tournaments = sqliteTable("tournaments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  date: integer("date", { mode: "timestamp" }).notNull(),
  location: text("location"),
  status: text("status", { enum: ["draft", "registration_open", "registration_closed", "in_progress", "completed"] }).default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// 3. Participants
export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"), // nullable if phone is provided
  phone: text("phone"), // nullable if email is provided
  optIn: integer("opt_in", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// 4. Teams
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  skillTier: text("skill_tier", { enum: ["Beginner", "Novice", "Low Intermediate", "Intermediate"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// 4.5. Tournament Teams (Many-to-Many linking Tournaments and Teams)
export const tournamentTeams = sqliteTable("tournament_teams", {
  tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
  teamId: text("team_id").notNull().references(() => teams.id),
});

// 5. Team Members (Many-to-Many linking Teams and Participants)
export const teamMembers = sqliteTable("team_members", {
  teamId: text("team_id").notNull().references(() => teams.id),
  participantId: text("participant_id").notNull().references(() => participants.id),
});

// 6. Courts
export const courts = sqliteTable("courts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
  name: text("name").notNull(),
  status: text("status", { enum: ["available", "in_progress", "awaiting_score"] }).default("available"),
});

// 7. Matches
export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
  team1Id: text("team1_id").references(() => teams.id),
  team2Id: text("team2_id").references(() => teams.id),
  courtId: text("court_id").references(() => courts.id),
  score1: integer("score1"),
  score2: integer("score2"),
  status: text("status", { enum: ["pending", "in_progress", "completed"] }).default("pending"),
  roundNumber: integer("round_number"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});
