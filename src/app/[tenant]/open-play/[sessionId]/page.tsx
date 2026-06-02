import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { LiveOpenPlayView } from "@/components/open-play/LiveOpenPlayView";

export default async function LiveOpenPlayPage({
  params,
}: {
  params: Promise<{ tenant: string; sessionId: string }>;
}) {
  const { tenant, sessionId } = await params;
  const tenantData = await fetchQuery(api.tenants.getById, { tenantId: tenant });

  if (!tenantData) {
    notFound();
  }

  return (
    <LiveOpenPlayView
      tenantName={tenantData.name}
      sessionId={sessionId as Id<"openPlaySessions">}
    />
  );
}
