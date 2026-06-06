"use client";

import { type FormEvent, type ReactNode, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Edit3, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PLAYER_SKILL_LEVELS,
  filterPlayers,
  playerDisplayName,
  sortPlayersByName,
  type DuprPresenceFilter,
  type PlayerDirectoryFilters,
  type PlayerSkillLevel,
  type PlayerSkillSource,
} from "@/lib/players/admin";

type Player = Doc<"players">;

type PlayerDirectoryAdminViewProps = {
  tenantId: Id<"tenants">;
  tenantName: string;
  tenantSlug: string;
};

type PlayerFormState = {
  firstName: string;
  lastName: string;
  skillSource: PlayerSkillSource;
  manualSkillLevel: PlayerSkillLevel;
  duprRating: string;
  username: string;
  email: string;
  phone: string;
  gender: string;
  avatarUrl: string;
  notes: string;
  optIn: boolean;
};

const EMPTY_FORM: PlayerFormState = {
  firstName: "",
  lastName: "",
  skillSource: "manual",
  manualSkillLevel: "Novice",
  duprRating: "",
  username: "",
  email: "",
  phone: "",
  gender: "",
  avatarUrl: "",
  notes: "",
  optIn: false,
};

const EMPTY_FILTERS: PlayerDirectoryFilters = {
  search: "",
  skillSource: "all",
  manualSkillLevel: "all",
  duprPresence: "all",
};

function textOrUndefined(value: string) {
  return value.trim() || undefined;
}

function playerToForm(player: Player): PlayerFormState {
  return {
    firstName: player.firstName,
    lastName: player.lastName,
    skillSource: player.skillSource,
    manualSkillLevel: player.manualSkillLevel,
    duprRating: player.duprRating === undefined ? "" : String(player.duprRating),
    username: player.username ?? "",
    email: player.email ?? "",
    phone: player.phone ?? "",
    gender: player.gender ?? "",
    avatarUrl: player.avatarUrl ?? "",
    notes: player.notes ?? "",
    optIn: player.optIn ?? false,
  };
}

export function PlayerDirectoryAdminView({
  tenantId,
  tenantName,
  tenantSlug,
}: PlayerDirectoryAdminViewProps) {
  const players = useQuery(api.players.listByTenant, { tenantId });
  const createPlayer = useMutation(api.players.createPlayer);
  const updatePlayer = useMutation(api.players.updatePlayer);
  const deletePlayer = useMutation(api.players.deletePlayer);
  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState<PlayerDirectoryFilters>(EMPTY_FILTERS);
  const [editingPlayerId, setEditingPlayerId] = useState<Id<"players"> | null>(null);
  const [form, setForm] = useState<PlayerFormState>(EMPTY_FORM);

  const sortedPlayers = useMemo(() => sortPlayersByName(players ?? []), [players]);
  const visiblePlayers = useMemo(
    () => filterPlayers(sortedPlayers, filters),
    [filters, sortedPlayers]
  );
  const editingPlayer = editingPlayerId
    ? (players ?? []).find((player) => player._id === editingPlayerId)
    : null;

  function updateForm<K extends keyof PlayerFormState>(key: K, value: PlayerFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function beginCreate() {
    setEditingPlayerId(null);
    setForm(EMPTY_FORM);
  }

  function beginEdit(player: Player) {
    setEditingPlayerId(player._id);
    setForm(playerToForm(player));
  }

  function submitPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const duprRating = form.duprRating.trim() === "" ? null : Number(form.duprRating);
    if (duprRating !== null && (!Number.isFinite(duprRating) || duprRating < 0)) {
      toast.error("Enter a valid DUPR rating.");
      return;
    }

    startTransition(async () => {
      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        skillSource: form.skillSource,
        manualSkillLevel: form.manualSkillLevel,
        username: textOrUndefined(form.username),
        email: textOrUndefined(form.email),
        phone: textOrUndefined(form.phone),
        gender: textOrUndefined(form.gender),
        avatarUrl: textOrUndefined(form.avatarUrl),
        notes: textOrUndefined(form.notes),
        optIn: form.optIn,
      };

      const result = editingPlayerId
        ? await updatePlayer({
            tenantId,
            playerId: editingPlayerId,
            ...payload,
            duprRating,
          })
        : await createPlayer({
            tenantId,
            ...payload,
            duprRating: duprRating ?? undefined,
          });

      if (result.success) {
        toast.success(editingPlayerId ? "Player updated." : "Player created.");
        if (!editingPlayerId) {
          setForm(EMPTY_FORM);
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitDelete(player: Player) {
    if (!window.confirm(`Delete ${playerDisplayName(player)}? This cannot be undone.`)) {
      return;
    }

    startTransition(async () => {
      const result = await deletePlayer({ tenantId, playerId: player._id });
      if (result.success) {
        if (editingPlayerId === player._id) beginCreate();
        toast.success("Player deleted.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{tenantName}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Player Directory</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/${tenantSlug}/admin/dashboard`}>Dashboard</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${tenantSlug}/admin/open-play`}>Open Play</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${tenantSlug}/admin/tournaments`}>Tournaments</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{editingPlayer ? "Edit Player" : "Create Player"}</CardTitle>
              <CardDescription>MVP profile, contact, skill, and consent fields.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submitPlayer}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name">
                    <Input
                      value={form.firstName}
                      onChange={(event) => updateForm("firstName", event.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Last name">
                    <Input
                      value={form.lastName}
                      onChange={(event) => updateForm("lastName", event.target.value)}
                      required
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Skill source">
                    <Select
                      value={form.skillSource}
                      onValueChange={(value) => updateForm("skillSource", value as PlayerSkillSource)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="dupr">DUPR</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Manual level">
                    <Select
                      value={form.manualSkillLevel}
                      onValueChange={(value) => updateForm("manualSkillLevel", value as PlayerSkillLevel)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLAYER_SKILL_LEVELS.map((level) => (
                          <SelectItem key={level} value={level}>
                            {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field label="DUPR rating">
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    inputMode="decimal"
                    value={form.duprRating}
                    onChange={(event) => updateForm("duprRating", event.target.value)}
                    placeholder="4.125"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Username">
                    <Input value={form.username} onChange={(event) => updateForm("username", event.target.value)} />
                  </Field>
                  <Field label="Gender">
                    <Input value={form.gender} onChange={(event) => updateForm("gender", event.target.value)} />
                  </Field>
                </div>

                <Field label="Email">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(event) => updateForm("email", event.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={(event) => updateForm("phone", event.target.value)}
                  />
                </Field>
                <Field label="Avatar URL">
                  <Input
                    type="url"
                    value={form.avatarUrl}
                    onChange={(event) => updateForm("avatarUrl", event.target.value)}
                  />
                </Field>
                <Field label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={(event) => updateForm("notes", event.target.value)}
                    className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </Field>

                <Label className="flex items-center gap-2">
                  <Checkbox
                    checked={form.optIn}
                    onCheckedChange={(checked) => updateForm("optIn", checked === true)}
                  />
                  Player has opted in
                </Label>

                <div className="flex gap-2">
                  <Button type="submit" disabled={isPending} className="flex-1 bg-[var(--tenant-primary)]">
                    <Plus />
                    {editingPlayer ? "Save changes" : "Create player"}
                  </Button>
                  {editingPlayer ? (
                    <Button type="button" variant="outline" disabled={isPending} onClick={beginCreate}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>
        </aside>

        <section className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Directory</CardTitle>
              <CardDescription>
                {players ? `${visiblePlayers.length} of ${players.length} players` : "Loading players"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_190px_160px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filters.search}
                    onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                    className="pl-9"
                    placeholder="Search name, contact, username"
                  />
                </div>
                <Select
                  value={filters.skillSource}
                  onValueChange={(value) =>
                    setFilters((current) => ({ ...current, skillSource: value as PlayerDirectoryFilters["skillSource"] }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="dupr">DUPR</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={filters.manualSkillLevel}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      manualSkillLevel: value as PlayerDirectoryFilters["manualSkillLevel"],
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All manual levels</SelectItem>
                    {PLAYER_SKILL_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filters.duprPresence}
                  onValueChange={(value) =>
                    setFilters((current) => ({ ...current, duprPresence: value as DuprPresenceFilter }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any DUPR</SelectItem>
                    <SelectItem value="with">Has DUPR</SelectItem>
                    <SelectItem value="without">No DUPR</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                {visiblePlayers.map((player) => (
                  <div
                    key={player._id}
                    className="grid gap-3 rounded-md border p-4 md:grid-cols-[auto_minmax(0,1fr)_auto]"
                  >
                    <div className="flex size-11 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                      <UserRound className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{playerDisplayName(player)}</p>
                        <Badge>{player.skillSource === "dupr" ? "DUPR" : "Manual"}</Badge>
                        <Badge>{player.manualSkillLevel}</Badge>
                        {player.duprRating !== undefined ? <Badge>DUPR {player.duprRating}</Badge> : null}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {[player.username, player.email, player.phone].filter(Boolean).join(" · ") || "No contact info"}
                      </p>
                      {player.notes ? (
                        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{player.notes}</p>
                      ) : null}
                    </div>
                    <div className="flex items-start gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => beginEdit(player)}>
                        <Edit3 />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => submitDelete(player)}
                        className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <Trash2 />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
                {visiblePlayers.length === 0 ? (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No players match those filters.
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}
