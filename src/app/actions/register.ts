"use server";

import { db } from "@/lib/db";
import { participants, teams, teamMembers } from "@/lib/db/schema";
import { registrationSchema } from "@/lib/validations/registration";
import { eq, and, or, inArray } from "drizzle-orm";
import { z } from "zod";

export async function registerTeamAction(tenantId: string, formData: z.infer<typeof registrationSchema>) {
  try {
    const data = registrationSchema.parse(formData);

    // 1. Duplicate check for emails/phones within this tenant
    const emailsToCheck = [data.player1.email, data.player2.email].filter(Boolean) as string[];
    const phonesToCheck = [data.player1.phone, data.player2.phone].filter(Boolean) as string[];

    const duplicateChecks = [];
    if (emailsToCheck.length > 0) duplicateChecks.push(inArray(participants.email, emailsToCheck));
    if (phonesToCheck.length > 0) duplicateChecks.push(inArray(participants.phone, phonesToCheck));

    if (duplicateChecks.length > 0) {
      const existingParticipants = await db.select().from(participants).where(
        and(
          eq(participants.tenantId, tenantId),
          or(...duplicateChecks)
        )
      );

      if (existingParticipants.length > 0) {
        return { success: false, error: "One or more participants are already registered with this email or phone number for this event." };
      }
    }

    // 2. Database Transaction
    await db.transaction(async (tx) => {
      const p1Id = crypto.randomUUID();
      const p2Id = crypto.randomUUID();
      const teamId = crypto.randomUUID();

      // Insert Participants
      await tx.insert(participants).values([
        {
          id: p1Id,
          tenantId,
          firstName: data.player1.firstName,
          lastName: data.player1.lastName,
          email: data.player1.email || null,
          phone: data.player1.phone || null,
          optIn: data.player1.optIn,
        },
        {
          id: p2Id,
          tenantId,
          firstName: data.player2.firstName,
          lastName: data.player2.lastName,
          email: data.player2.email || null,
          phone: data.player2.phone || null,
          optIn: data.player2.optIn,
        }
      ]);

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
    });

    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: false, error: "Validation failed: " + (error as any).errors[0].message };
    }
    console.error("Registration error:", error);
    return { success: false, error: "An unexpected error occurred during registration." };
  }
}
