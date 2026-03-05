"use server";

import { db } from "@/lib/db";
import { matches, teams, tournaments, tournamentTeams } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateRoundRobinMatches } from "@/lib/utils/bracket";

export async function generateBracketAction(tenantId: string, tournamentId: string) {
  try {
    // 1. Verify tournament exists and is in the correct state
    const t = await db.select().from(tournaments).where(
      and(
        eq(tournaments.id, tournamentId),
        eq(tournaments.tenantId, tenantId)
      )
    ).get();

    if (!t) {
      return { success: false, error: "Tournament not found." };
    }

    if (t.status !== "registration_open" && t.status !== "draft") {
      return { success: false, error: "Tournament must be in Draft or Registration Open state to generate a bracket." };
    }

    // 2. Fetch all teams mapped to this tournament
    const registeredTeams = await db
      .select({
        id: teams.id,
        name: teams.name,
        skillTier: teams.skillTier,
      })
      .from(teams)
      .innerJoin(tournamentTeams, eq(teams.id, tournamentTeams.teamId))
      .where(eq(tournamentTeams.tournamentId, tournamentId));

    if (registeredTeams.length < 2) {
      return { success: false, error: "Not enough teams registered to generate a bracket." };
    }

    // 3. Group teams by skill tier
    const teamsByTier = registeredTeams.reduce((acc, team) => {
      const tier = team.skillTier;
      if (!acc[tier]) acc[tier] = [];
      acc[tier].push(team);
      return acc;
    }, {} as Record<string, typeof registeredTeams>);

    // 4. Generate the round robin matches per tier
    const matchesToInsert: (typeof matches.$inferInsert)[] = [];

    for (const tierTeams of Object.values(teamsByTier)) {
      if (tierTeams.length < 2) continue; // Can't play against themselves

      const generatedMatches = generateRoundRobinMatches(tierTeams);

      for (const m of generatedMatches) {
        matchesToInsert.push({
          id: crypto.randomUUID(),
          tenantId,
          tournamentId,
          team1Id: m.team1.id,
          team2Id: m.team2?.id || null, // null if they have a Bye
          roundNumber: m.round,
          status: "pending" as const,
        });
      }
    }

    if (matchesToInsert.length === 0) {
      return { success: false, error: "Failed to generate any valid matches. Ensure at least one tier has 2+ teams." };
    }

    // 5. Execute transaction: Insert matches and update tournament state
    await db.transaction(async (tx) => {
      // Clear any existing matches for this tournament if rewriting the bracket
      await tx.delete(matches).where(eq(matches.tournamentId, tournamentId));

      // Insert the new bracket
      await tx.insert(matches).values(matchesToInsert);

      // Lock the tournament registration state, meaning bracket is locked and we are 'in_progress'
      await tx.update(tournaments)
        .set({ status: "in_progress" })
        .where(eq(tournaments.id, tournamentId));
    });

    return { success: true, message: "Bracket generated successfully!" };

  } catch (error) {
    console.error("Error generating bracket:", error);
    return { success: false, error: "An unexpected error occurred while generating the bracket." };
  }
}
