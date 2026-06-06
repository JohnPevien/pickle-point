"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type WorkspaceSetupFormProps = {
  defaultContactEmail?: string;
};

const DEFAULT_PRIMARY_COLOR = "#ff007f";
const DEFAULT_SECONDARY_COLOR = "#000000";

export function WorkspaceSetupForm({ defaultContactEmail = "" }: WorkspaceSetupFormProps) {
  const router = useRouter();
  const createWorkspace = useMutation(api.tenants.createWorkspace);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "",
    contactEmail: defaultContactEmail,
    logoUrl: "",
    primaryColor: DEFAULT_PRIMARY_COLOR,
    secondaryColor: DEFAULT_SECONDARY_COLOR,
  });

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
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
        const result = await createWorkspace({
          name: form.name,
          contactEmail: form.contactEmail,
          logoUrl: form.logoUrl || undefined,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
        });

        if (result.success) {
          toast.success(result.created ? "Workspace created." : "Workspace already exists.");
          router.push(`/${result.tenantId}/admin/dashboard`);
          router.refresh();
        } else {
          toast.error(result.error ?? "Could not create workspace.");
        }
      } catch {
        toast.error("Could not create workspace.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your workspace</CardTitle>
        <CardDescription>
          This becomes the admin home for your pickleball events and player directory.
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
                placeholder="Downtown Pickleball Club"
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
                placeholder="gm@example.com"
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
          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? "Creating..." : "Create workspace"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
