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
  return [base, tenantSlug, ...pathSegments].join("/");
}
