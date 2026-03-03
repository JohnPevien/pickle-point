import { z } from "zod";

const playerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  phone: z.string().min(10, "Phone number must be at least 10 digits").optional().or(z.literal("")),
  optIn: z.boolean().default(false),
}).refine(data => data.email || data.phone, {
  message: "Either email or phone is required to register",
  path: ["email"], // We'll attach this error to the email field by default
});

export const registrationSchema = z.object({
  teamName: z.string().min(1, "Team name is required"),
  skillTier: z.enum(["Beginner", "Novice", "Low Intermediate", "Intermediate"] as const, {
    message: "Please select a skill tier",
  }),
  player1: playerSchema,
  player2: playerSchema,
});

export type RegistrationFormValues = z.infer<typeof registrationSchema>;
