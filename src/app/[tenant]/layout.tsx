import { notFound } from "next/navigation";
import React from "react";
import { resolveTenantBySlug } from "@/lib/tenant/server";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;

  // The [tenant] route parameter is a workspace slug, never a Convex
  // tenant id. Resolve it server-side through the active-only public
  // projection; an unknown/disabled slug surfaces a public 404.
  const tenantData = await resolveTenantBySlug(tenant);

  if (!tenantData) {
    notFound();
  }

  // Inject primary and secondary colors as inline CSS variables on the wrapping div.
  return (
    <div
      className="min-h-screen antialiased bg-background text-foreground"
      style={
        {
          "--tenant-primary": tenantData.primaryColor || "#000000",
          "--tenant-secondary": tenantData.secondaryColor || "#ffffff",
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
