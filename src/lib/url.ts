/**
 * Builds a public URL for a tenant-scoped resource.
 * Pure function — does not depend on window or browser APIs.
 */
export function buildTenantUrl(
  origin: string,
  tenantSlug: string,
  ...pathSegments: string[]
): string {
  const base = origin.replace(/\/+$/, "");
  const normalizeSegment = (segment: string) => segment.replace(/^\/+|\/+$/g, "");
  return [base, normalizeSegment(tenantSlug), ...pathSegments.map(normalizeSegment)].join("/");
}
