"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";
import { Building2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type VenueAdminViewProps = {
  tenantId: Id<"tenants">;
};

type VenueFormState = {
  name: string;
  courtCount: string;
  address: string;
};

type Venue = Doc<"venues">;

const EMPTY_FORM: VenueFormState = {
  name: "",
  courtCount: "4",
  address: "",
};

function parseCourtCount(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function venueCountLabel(count: number) {
  return count === 1 ? "1 venue" : `${count} venues`;
}

function formFromVenue(venue: Venue): VenueFormState {
  return {
    name: venue.name,
    courtCount: String(venue.courtCount),
    address: venue.address ?? "",
  };
}

export function VenueAdminView({ tenantId }: VenueAdminViewProps) {
  const venues = useQuery(api.venues.listByTenant, { tenantId, limit: 100 });
  const createVenue = useMutation(api.venues.createVenue);
  const updateVenue = useMutation(api.venues.updateVenue);
  const deleteVenue = useMutation(api.venues.deleteVenue);
  const [isPending, startTransition] = useTransition();
  const [createForm, setCreateForm] = useState<VenueFormState>(EMPTY_FORM);
  const [editingVenueId, setEditingVenueId] = useState<Id<"venues"> | null>(null);
  const [editForm, setEditForm] = useState<VenueFormState>(EMPTY_FORM);

  const sortedVenues = useMemo(
    () => [...(venues ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [venues]
  );

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const courtCount = parseCourtCount(createForm.courtCount);
    if (!createForm.name.trim()) {
      toast.error("Venue name is required.");
      return;
    }
    if (courtCount === null) {
      toast.error("Court count must be a positive whole number.");
      return;
    }

    startTransition(async () => {
      const result = await createVenue({
        tenantId,
        name: createForm.name,
        courtCount,
        address: createForm.address.trim() || undefined,
      });

      if (result.success) {
        setCreateForm(EMPTY_FORM);
        toast.success("Venue created.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function beginEdit(venue: Venue) {
    setEditingVenueId(venue._id);
    setEditForm(formFromVenue(venue));
  }

  function cancelEdit() {
    setEditingVenueId(null);
    setEditForm(EMPTY_FORM);
  }

  function submitUpdate(event: FormEvent<HTMLFormElement>, venueId: Id<"venues">) {
    event.preventDefault();
    const courtCount = parseCourtCount(editForm.courtCount);
    if (!editForm.name.trim()) {
      toast.error("Venue name is required.");
      return;
    }
    if (courtCount === null) {
      toast.error("Court count must be a positive whole number.");
      return;
    }

    startTransition(async () => {
      const result = await updateVenue({
        tenantId,
        venueId,
        name: editForm.name,
        courtCount,
        address: editForm.address.trim() || undefined,
      });

      if (result.success) {
        cancelEdit();
        toast.success("Venue updated.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitDelete(venueId: Id<"venues">) {
    if (!window.confirm("Delete this venue?")) {
      return;
    }

    startTransition(async () => {
      const result = await deleteVenue({ tenantId, venueId });
      if (result.success) {
        toast.success("Venue deleted.");
      } else {
        toast.error(result.error);
      }
    });
  }

  if (venues === undefined) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-28 rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>New Venue</CardTitle>
          <CardDescription>Add a club, gym, or court location.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submitCreate}>
            <VenueFields
              form={createForm}
              onChange={setCreateForm}
              nameId="venue-name"
              courtCountId="venue-courts"
              addressId="venue-address"
            />
            <Button type="submit" disabled={isPending} className="w-full">
              <Plus />
              Create venue
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Venues</h2>
            <p className="text-sm text-muted-foreground">{venueCountLabel(sortedVenues.length)} configured</p>
          </div>
        </div>

        {sortedVenues.length === 0 ? (
          <Card className="border-dashed py-12 text-center">
            <CardHeader>
              <CardTitle>No Venues Yet</CardTitle>
              <CardDescription>Create your first venue before assigning courts to play sessions.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sortedVenues.map((venue) => (
              <Card key={venue._id}>
                {editingVenueId === venue._id ? (
                  <form onSubmit={(event) => submitUpdate(event, venue._id)}>
                    <CardHeader>
                      <CardTitle>Edit Venue</CardTitle>
                      <CardDescription>Changes apply to future venue lists.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <VenueFields
                        form={editForm}
                        onChange={setEditForm}
                        nameId={`venue-name-${venue._id}`}
                        courtCountId={`venue-courts-${venue._id}`}
                        addressId={`venue-address-${venue._id}`}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" disabled={isPending} size="sm">
                          <Save />
                          Save
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={isPending}>
                          <X />
                          Cancel
                        </Button>
                      </div>
                    </CardContent>
                  </form>
                ) : (
                  <>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <CardTitle className="truncate">{venue.name}</CardTitle>
                          <CardDescription>{venue.courtCount} courts</CardDescription>
                        </div>
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--tenant-primary)] text-primary-foreground">
                          <Building2 />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="min-h-5 text-sm text-muted-foreground">
                        {venue.address || "No address on file."}
                      </p>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => beginEdit(venue)}>
                          <Pencil />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={isPending}
                          onClick={() => submitDelete(venue._id)}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function VenueFields({
  form,
  onChange,
  nameId,
  courtCountId,
  addressId,
}: {
  form: VenueFormState;
  onChange: (form: VenueFormState) => void;
  nameId: string;
  courtCountId: string;
  addressId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>Venue name</Label>
        <Input
          id={nameId}
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
          placeholder="Downtown Pickleball"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={courtCountId}>Court count</Label>
        <Input
          id={courtCountId}
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={form.courtCount}
          onChange={(event) => onChange({ ...form, courtCount: event.target.value })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={addressId}>Address (optional)</Label>
        <Input
          id={addressId}
          value={form.address}
          onChange={(event) => onChange({ ...form, address: event.target.value })}
          placeholder="123 Main St"
        />
      </div>
    </div>
  );
}
