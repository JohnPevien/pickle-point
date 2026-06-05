import { fetchQuery } from "convex/nextjs";
import { notFound } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../../convex/_generated/api";
import { VenueAdminView } from "@/components/admin/VenueAdminView";

export default async function AdminVenuesPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });

  if (!tenantData) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link
              href={`/${tenant}/admin/dashboard`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Dashboard
            </Link>
            <h1 className="text-xl font-bold" style={{ color: "var(--tenant-primary)" }}>
              Venues
            </h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <VenueAdminView tenantId={tenantData._id} />
      </main>
    </div>
  );
}
