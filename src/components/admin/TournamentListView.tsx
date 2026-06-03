"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { statusLabel, formatLabel, formatTournamentDate, type TournamentStatus, type TournamentFormat } from "@/lib/tournament/helpers";
import Link from "next/link";

type Props = {
  tenantId: Id<"tenants">;
  tenant: string;
};

const FORMATS: { value: TournamentFormat; label: string }[] = [
  { value: "single_elimination", label: "Single Elimination" },
  { value: "double_elimination", label: "Double Elimination" },
  { value: "round_robin", label: "Round Robin" },
];

export function TournamentListView({ tenantId, tenant }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [format, setFormat] = useState<TournamentFormat>("single_elimination");
  const [location, setLocation] = useState("");

  const tournaments = useQuery(api.tournaments.listByTenant, { tenantId });
  const createTournament = useMutation(api.tournaments.createTournament);

  function resetForm() {
    setName("");
    setDate("");
    setFormat("single_elimination");
    setLocation("");
    setShowForm(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Tournament name is required.");
      return;
    }
    const parsedDate = date ? new Date(date).getTime() : Date.now();
    if (isNaN(parsedDate)) {
      toast.error("Invalid date.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await createTournament({
          tenantId,
          name: name.trim(),
          date: parsedDate,
          format,
          location: location.trim() || undefined,
        });
        if (res.success) {
          toast.success("Tournament created.");
          resetForm();
          router.push(`/${tenant}/admin/tournaments/${res.tournamentId}`);
        } else {
          toast.error(res.error ?? "Failed to create tournament.");
        }
      } catch {
        toast.error("Failed to create tournament.");
      }
    });
  }

  if (tournaments === undefined) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 bg-muted rounded-md" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>New Tournament</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="t-name">Name</Label>
                  <Input
                    id="t-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Summer Open 2026"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-date">Date</Label>
                  <Input
                    id="t-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-format">Format</Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as TournamentFormat)}>
                    <SelectTrigger id="t-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-location">Location (optional)</Label>
                  <Input
                    id="t-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Court A"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={isPending} size="sm">
                  Create Tournament
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetForm}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {tournaments.length === 0 && !showForm ? (
        <Card className="text-center py-12">
          <CardHeader>
            <CardTitle>No Tournaments Yet</CardTitle>
            <CardDescription>
              Create a tournament to get started, or wait for registrations to generate one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" onClick={() => setShowForm(true)}>
              New Tournament
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {tournaments.length > 0 && !showForm && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowForm(true)}>
                New Tournament
              </Button>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => (
            <Link
              key={t._id}
              href={`/${tenant}/admin/tournaments/${t._id}`}
              className="block"
            >
              <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{t.name}</CardTitle>
                    <span
                      className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(t.status as TournamentStatus)}`}
                    >
                      {statusLabel(t.status as TournamentStatus)}
                    </span>
                  </div>
                  <CardDescription>
                    {formatLabel(t.format as TournamentFormat)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {formatTournamentDate(t.date)}
                  </p>
                  {t.location && (
                    <p className="text-sm text-muted-foreground truncate">{t.location}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        </>
      )}
    </div>
  );
}

function statusBadgeClass(status: TournamentStatus): string {
  switch (status) {
    case "live":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "completed":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    case "cancelled":
      return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
    case "registration_open":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "bracket_generated":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}
