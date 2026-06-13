"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type WorkspaceSettingsFormProps = {
  tenant: Doc<"tenants">;
};

export function WorkspaceSettingsForm({ tenant }: WorkspaceSettingsFormProps) {
  const router = useRouter();
  const updateWorkspace = useMutation(api.tenants.updateWorkspace);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: tenant.name,
    contactEmail: tenant.contactEmail,
    logoUrl: tenant.logoUrl ?? "",
    primaryColor: tenant.primaryColor ?? "#ff007f",
    secondaryColor: tenant.secondaryColor ?? "#000000",
  });

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm({
      name: tenant.name,
      contactEmail: tenant.contactEmail,
      logoUrl: tenant.logoUrl ?? "",
      primaryColor: tenant.primaryColor ?? "#ff007f",
      secondaryColor: tenant.secondaryColor ?? "#000000",
    });
  }

  function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("Workspace name is required.");
      return;
    }
    if (!form.contactEmail.trim()) {
      toast.error("Contact email is required.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateWorkspace({
          tenantId: tenant._id,
          name: form.name,
          contactEmail: form.contactEmail,
          logoUrl: form.logoUrl || undefined,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
        });

        if (result.success) {
          toast.success("Workspace updated.");
          router.refresh();
        } else {
          toast.error(result.error ?? "Could not update workspace.");
        }
      } catch (error) {
        console.error("Failed to update workspace settings", error);
        toast.error("Could not update workspace.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace profile</CardTitle>
        <CardDescription>
          Update the public name, contact email, logo, and theme colors for this workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={submitWorkspace}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workspace-contact">Contact email</Label>
              <Input
                id="workspace-contact"
                type="email"
                value={form.contactEmail}
                onChange={(event) => updateField("contactEmail", event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workspace-logo">Logo URL</Label>
              <Input
                id="workspace-logo"
                type="url"
                value={form.logoUrl}
                onChange={(event) => updateField("logoUrl", event.target.value)}
                placeholder="https://example.com/logo.png"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workspace-primary">Primary color</Label>
              <Input
                id="workspace-primary"
                type="color"
                value={form.primaryColor}
                onChange={(event) => updateField("primaryColor", event.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workspace-secondary">Secondary color</Label>
              <Input
                id="workspace-secondary"
                type="color"
                value={form.secondaryColor}
                onChange={(event) => updateField("secondaryColor", event.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save changes"}
            </Button>
            <Button type="button" variant="outline" disabled={isPending} onClick={resetForm}>
              Reset
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
