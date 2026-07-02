import { RegistrationForm } from "@/components/forms/RegistrationForm";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import Image from "next/image";
import { resolveTenantOrNotFound } from "@/lib/tenant/server";

export default async function RegisterPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;

  // The [tenant] route parameter is a workspace slug; resolve it to the
  // trusted tenant id server-side. Unknown/disabled slugs 404 here.
  const tenantData = await resolveTenantOrNotFound(tenant);

  // Fetch the registration-open tournament for this tenant from Convex.
  const activeTournament = await fetchQuery(api.tournaments.getActiveTournament, { tenantId: tenantData._id });

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
        <RegistrationForm tenantId={tenantData._id} tournamentId={activeTournament._id} />
      ) : (
        <div className="text-center p-12 border-2 border-dashed rounded-lg bg-muted/20">
          <p className="text-lg">No open tournaments found.</p>
          <p className="text-sm text-muted-foreground mt-2">Please check back later or contact the organizer.</p>
        </div>
      )}
    </div>
  );
}
