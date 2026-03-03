import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

  // Ideally, 'tenant' here would be the unique slug or ID of the game master.
  // For now, we search by ID. Later this might be a unique slug field.
  const [tenantData] = await db.select().from(tenants).where(eq(tenants.id, tenant));

  if (!tenantData) {
    notFound();
  }

  // Inject primary and secondary colors as inline CSS variables on the wrapping div.
  // This allows Tailwind 4 or Shadcn to inherit these using bg-[var(--primary)] etc.
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
