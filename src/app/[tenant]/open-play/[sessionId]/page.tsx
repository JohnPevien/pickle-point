import type { Id } from "../../../../../convex/_generated/dataModel";
import { LiveOpenPlayView } from "@/components/open-play/LiveOpenPlayView";
import { resolveTenantOrNotFound } from "@/lib/tenant/server";

export default async function LiveOpenPlayPage({
  params,
}: {
  params: Promise<{ tenant: string; sessionId: string }>;
}) {
  const { tenant, sessionId } = await params;
  const tenantData = await resolveTenantOrNotFound(tenant);

  return (
    <LiveOpenPlayView
      tenantName={tenantData.name}
      sessionId={sessionId as Id<"openPlaySessions">}
    />
  );
}
