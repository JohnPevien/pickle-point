"use server";

import { db } from "@/lib/db";
import { participants, teams, teamMembers, tournamentTeams, tournaments } from "@/lib/db/schema";
import { registrationSchema, type RegistrationFormValues } from "@/lib/validations/registration";
import { eq, and, or, type SQL } from "drizzle-orm";

export async function registerTeamAction(
  tenantId: string,
  tournamentId: string,
  data: RegistrationFormValues
) {
  try {
    const validation = registrationSchema.safeParse(data);

    if (!validation.success) {
      const firstIssue = validation.error.issues[0]?.message ?? "Invalid registration data.";
      return { success: false, error: `Validation failed: ${firstIssue}` };
    }

    const normalizeContact = (value?: string | null) => {
      const normalized = value?.trim();
      return normalized ? normalized : null;
    };

    const validatedData = validation.data;
    const player1 = {
      ...validatedData.player1,
      email: normalizeContact(validatedData.player1.email),
      phone: normalizeContact(validatedData.player1.phone),
    };
    const player2 = {
      ...validatedData.player2,
      email: normalizeContact(validatedData.player2.email),
      phone: normalizeContact(validatedData.player2.phone),
    };

    if ((!player1.email && !player1.phone) || (!player2.email && !player2.phone)) {
      return { success: false, error: "Validation failed: Either email or phone is required to register" };
    }

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
    const findExistingParticipantInTournament = async (email: string | null, phone: string | null) => {
      if (!email && !phone) return null;

      const conditions: SQL[] = [];
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

    const p1Check = await findExistingParticipantInTournament(player1.email, player1.phone);
    const p2Check = await findExistingParticipantInTournament(player2.email, player2.phone);

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
            firstName: player1.firstName,
            lastName: player1.lastName,
            email: player1.email,
            phone: player1.phone,
            optIn: player1.optIn,
          });
      }

      let p2Id = p2Check?.participantId;
      if (!p2Id) {
          p2Id = crypto.randomUUID();
          await tx.insert(participants).values({
            id: p2Id,
            tenantId,
            firstName: player2.firstName,
            lastName: player2.lastName,
            email: player2.email,
            phone: player2.phone,
            optIn: player2.optIn,
          });
      }

      const teamId = crypto.randomUUID();

      // Insert Team
      await tx.insert(teams).values({
        id: teamId,
        tenantId,
        name: validatedData.teamName,
        skillTier: validatedData.skillTier,
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
    console.error("Registration error:", error);
    return { success: false, error: "An unexpected error occurred during registration." };
  }
}
