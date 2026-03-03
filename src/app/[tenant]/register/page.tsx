import { RegistrationForm } from "@/components/forms/RegistrationForm";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Image from "next/image";

export default async function RegisterPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;

  const [tenantData] = await db.select().from(tenants).where(eq(tenants.id, tenant));

  if (!tenantData) {
    notFound();
  }

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
          {tenantData.name} Tournament Registration
        </h1>
        <p className="text-muted-foreground mt-2 text-center">
          Register your team below to participate.
        </p>
      </div>

      <RegistrationForm tenantId={tenant} />
    </div>
  );
}
