import { RegistrationForm } from "@/components/forms/RegistrationForm";
import { db } from "@/lib/db";
import { tenants, tournaments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import Image from "next/image";

export default async function RegisterPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;

  const [tenantData] = await db.select().from(tenants).where(eq(tenants.id, tenant));

  if (!tenantData) {
    notFound();
  }

  // Fetch the active tournament for this tenant (Draft or Registration Open)
  const [activeTournament] = await db.select().from(tournaments).where(
    and(
      eq(tournaments.tenantId, tenant),
      eq(tournaments.status, "registration_open")
    )
  ).limit(1);

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="flex flex-col items-center mb-8">
        {tenantData.logoUrl ? (
          <Image src={tenantData.logoUrl} alt={`${tenantData.name} Logo`} width={150} height={150} className="mb-4 object-contain" />
        ) : (
          <div className="w-24 h-24 rounded-full mb-4 flex items-center justify-center text-primary-foreground text-3xl font-bold" style={{ backgroundColor: "var(--tenant-primary)" }}>
            {tenantData.name.charAt(0)}
          </div>
        )}
        <h1 className="text-3xl font-bold text-center" style={{ color: "var(--tenant-primary)" }}>
          {activeTournament ? `${activeTournament.name} Registration` : `${tenantData.name} Tournaments`}
        </h1>
        <p className="text-muted-foreground mt-2 text-center">
          {activeTournament ? "Register your team below to participate." : "Registration is currently closed or no active tournaments exist."}
        </p>
      </div>

      {activeTournament ? (
        <RegistrationForm tenantId={tenant} tournamentId={activeTournament.id} />
      ) : (
        <div className="text-center p-12 border-2 border-dashed rounded-lg bg-muted/20">
          <p className="text-lg">No open tournaments found.</p>
          <p className="text-sm text-muted-foreground mt-2">Please check back later or contact the organizer.</p>
        </div>
      )}
    </div>
  );
}
