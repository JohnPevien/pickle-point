"use server";

import { db } from "@/lib/db";
import { participants, teams, teamMembers, tournamentTeams, tournaments } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
import { z } from "zod"; // Keep z for error handling, even if schema.parse is removed

export async function registerTeamAction(
  tenantId: string,
  tournamentId: string,
  data: {
    teamName: string;
    skillTier: "Beginner" | "Novice" | "Low Intermediate" | "Intermediate";
    player1: { firstName: string; lastName: string; email?: string; phone?: string; optIn: boolean };
    player2: { firstName: string; lastName: string; email?: string; phone?: string; optIn: boolean };
  }
) {
  try {
    // 1. Verify the tournament belongs to the tenant and is open for registration
    const activeTournament = await db.select().from(tournaments).where(
      and(
        eq(tournaments.id, tournamentId),
        eq(tournaments.tenantId, tenantId)
      )
    ).get();

    if (!activeTournament || activeTournament.status !== "registration_open") {
      return { success: false, error: "This tournament is currently not accepting registrations." };
    }

    // Helper to check for existing participants specifically within THIS tournament
    const findExistingParticipantInTournament = async (email?: string, phone?: string) => {
      if (!email && !phone) return null;

      const conditions = [];
      if (email) conditions.push(eq(participants.email, email));
      if (phone) conditions.push(eq(participants.phone, phone));

      const pIdQuery = await db.select({ id: participants.id })
                               .from(participants)
                               .where(
                                 and(
                                    eq(participants.tenantId, tenantId),
                                    or(...conditions)
                                 )
                               )
                               .get();
      if (!pIdQuery) return null; // Participant doesn't exist at all

      // Check if they are in this specific tournament
      const inTournament = await db.select().from(teamMembers)
                                   .innerJoin(tournamentTeams, eq(teamMembers.teamId, tournamentTeams.teamId))
                                   .where(
                                     and(
                                       eq(teamMembers.participantId, pIdQuery.id),
                                       eq(tournamentTeams.tournamentId, tournamentId)
                                     )
                                   ).get();
      
      return {
        participantId: pIdQuery.id,
        isRegisteredForThisTournament: !!inTournament
      };
    };

    const p1Check = await findExistingParticipantInTournament(data.player1.email, data.player1.phone);
    const p2Check = await findExistingParticipantInTournament(data.player2.email, data.player2.phone);

    if (p1Check?.isRegisteredForThisTournament || p2Check?.isRegisteredForThisTournament) {
      return { success: false, error: "One or both players are already registered for this tournament." };
    }

    // 2. Perform database insertions atomically via transaction
    await db.transaction(async (tx) => {
      let p1Id = p1Check?.participantId;
      if (!p1Id) {
          p1Id = crypto.randomUUID();
          await tx.insert(participants).values({
            id: p1Id,
            tenantId,
            firstName: data.player1.firstName,
            lastName: data.player1.lastName,
            email: data.player1.email,
            phone: data.player1.phone || null,
            optIn: data.player1.optIn,
          });
      }

      let p2Id = p2Check?.participantId;
      if (!p2Id) {
          p2Id = crypto.randomUUID();
          await tx.insert(participants).values({
            id: p2Id,
            tenantId,
            firstName: data.player2.firstName,
            lastName: data.player2.lastName,
            email: data.player2.email,
            phone: data.player2.phone || null,
            optIn: data.player2.optIn,
          });
      }

      const teamId = crypto.randomUUID();

      // Insert Team
      await tx.insert(teams).values({
        id: teamId,
        tenantId,
        name: data.teamName,
        skillTier: data.skillTier,
      });

      // Link in teamMembers
      await tx.insert(teamMembers).values([
        { teamId, participantId: p1Id },
        { teamId, participantId: p2Id }
      ]);

      // Link team to tournament
      await tx.insert(tournamentTeams).values({
        tournamentId,
        teamId,
      });
    });

    return { success: true };
  } catch (error) {
    // The original DUPLICATE_PARTICIPANT error is now handled by the specific tournament check
    // and returns a more specific message.
    if (error instanceof z.ZodError) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: false, error: "Validation failed: " + (error as any).issues[0].message };
    }
    console.error("Registration error:", error);
    return { success: false, error: "An unexpected error occurred during registration." };
  }
}
