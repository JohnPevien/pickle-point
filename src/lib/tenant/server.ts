import { fetchQuery } from "convex/nextjs";
import { notFound } from "next/navigation";
import { cache } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Public tenant projection resolved by slug. Mirrors the shape returned
 * by `tenants.getPublicBySlug`: the active tenant's `_id`, `slug`,
 * `name`, `timezone`, and optional branding. Private config
 * (`workosOrganizationId`, `status`, contact email) is never included.
 */
export type ResolvedTenant = {
  _id: Id<"tenants">;
  slug: string;
  name: string;
  timezone: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
};

/**
 * Resolve a tenant strictly from its public slug, server-side. The
 * `[tenant]` route parameter is a workspace slug — NEVER a Convex tenant
 * id — so this is the only path from a URL to a trusted tenant `_id`.
 *
 * `tenants.getPublicBySlug` collapses unknown, disabled, and legacy rows
 * to `null`; this helper returns `null` in those cases so the caller can
 * invoke Next.js `notFound()` and surface a public 404 without leaking
 * which other tenants exist.
 *
 * Backend calls that need a `tenantId` must use the resolved `_id`, never
 * the raw route parameter.
 */
async function fetchTenantBySlug(
  slug: string,
): Promise<ResolvedTenant | null> {
  return await fetchQuery(api.tenants.getPublicBySlug, { slug });
}

// Layouts and pages can request the same tenant during one server render.
// React's request cache deduplicates that Convex read without persisting
// tenant state across requests.
export const resolveTenantBySlug = cache(fetchTenantBySlug);

/**
 * Resolve a tenant by slug and bail to `notFound()` when the slug is
 * unknown or the tenant is disabled. Returns the trusted tenant
 * projection so layouts/pages can pass `_id` downward to backend calls.
 */
export async function resolveTenantOrNotFound(
  slug: string,
): Promise<ResolvedTenant> {
  const tenant = await resolveTenantBySlug(slug);
  if (!tenant) {
    notFound();
  }
  return tenant;
}
