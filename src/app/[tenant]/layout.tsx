import { fetchQuery } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { notFound } from "next/navigation";
import React from "react";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;

  // Query tenant configuration from Convex
  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });

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
