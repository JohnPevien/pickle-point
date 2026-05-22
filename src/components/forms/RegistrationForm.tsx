"use client";

import { useTransition } from "react";
import { useForm, Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registrationSchema, RegistrationFormValues } from "@/lib/validations/registration";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

function PlayerFields({
  playerNumber,
  control,
}: {
  playerNumber: 1 | 2;
  control: Control<RegistrationFormValues>;
}) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Player {playerNumber}</CardTitle>
        <CardDescription>Enter details for the {playerNumber === 1 ? "first" : "second"} team member.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={control}
            name={`player${playerNumber}.firstName`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name</FormLabel>
                <FormControl><Input placeholder="John" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`player${playerNumber}.lastName`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last Name</FormLabel>
                <FormControl><Input placeholder="Doe" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={control}
            name={`player${playerNumber}.email`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" placeholder="john@example.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`player${playerNumber}.phone`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl><Input placeholder="(555) 123-4567" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={control}
          name={`player${playerNumber}.optIn`}
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Receive Tournament Updates</FormLabel>
                <p className="text-sm text-muted-foreground">Opt-in to receive important notifications.</p>
              </div>
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}

export function RegistrationForm({ tenantId, tournamentId }: { tenantId: Id<"tenants">, tournamentId: Id<"tournaments"> }) {
  const [isPending, startTransition] = useTransition();
  const registerTeam = useMutation(api.players.registerTournamentTeam);

  const form = useForm<RegistrationFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(registrationSchema) as any,
    defaultValues: {
      teamName: "",
      skillTier: undefined,
      player1: { firstName: "", lastName: "", email: "", phone: "", optIn: false },
      player2: { firstName: "", lastName: "", email: "", phone: "", optIn: false },
    },
  });

  function onSubmit(values: RegistrationFormValues) {
    startTransition(async () => {
      try {
        const result = await registerTeam({
          tenantId,
          tournamentId,
          teamName: values.teamName,
          skillTier: values.skillTier,
          player1: {
            firstName: values.player1.firstName,
            lastName: values.player1.lastName,
            email: values.player1.email || undefined,
            phone: values.player1.phone || undefined,
            optIn: values.player1.optIn,
          },
          player2: {
            firstName: values.player2.firstName,
            lastName: values.player2.lastName,
            email: values.player2.email || undefined,
            phone: values.player2.phone || undefined,
            optIn: values.player2.optIn,
          },
        });

        if (result.success) {
          toast.success("Team registered successfully!");
          form.reset();
        } else {
          toast.error(result.error || "Failed to register team.");
        }
      } catch (error) {
        console.error("Registration error:", error);
        toast.error("An unexpected error occurred. Please try again.");
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 max-w-2xl mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Team Details</CardTitle>
            <CardDescription>Choose a team name and skill level.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="teamName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Team Name</FormLabel>
                  <FormControl><Input placeholder="The Pickleballers" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="skillTier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Skill Tier</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select skill tier" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Beginner">Beginner</SelectItem>
                      <SelectItem value="Novice">Novice</SelectItem>
                      <SelectItem value="Low Intermediate">Low Intermediate</SelectItem>
                      <SelectItem value="High Intermediate">High Intermediate</SelectItem>
                      <SelectItem value="Advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <PlayerFields playerNumber={1} control={form.control} />
        <PlayerFields playerNumber={2} control={form.control} />

        <Button type="submit" disabled={isPending} className="w-full bg-(--tenant-primary) hover:opacity-90">
          {isPending ? "Registering..." : "Submit Registration"}
        </Button>
      </form>
    </Form>
  );
}
