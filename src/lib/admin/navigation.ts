export type AdminNavItem = {
  key: string;
  label: string;
  segment: string;
  matchSubpaths?: boolean;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { key: "dashboard", label: "Dashboard", segment: "dashboard" },
  { key: "open-play", label: "Open Play", segment: "open-play" },
  { key: "tournaments", label: "Tournaments", segment: "tournaments", matchSubpaths: true },
  { key: "players", label: "Players", segment: "players" },
  { key: "venues", label: "Venues", segment: "venues" },
  { key: "workspace", label: "Workspace", segment: "workspace" },
];

export function getAdminNavHref(tenantSlug: string, segment: string) {
  return `/${tenantSlug}/admin/${segment}`;
}

export function isAdminNavItemActive(
  pathname: string,
  tenantSlug: string,
  item: AdminNavItem,
) {
  const href = getAdminNavHref(tenantSlug, item.segment);

  if (item.matchSubpaths) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return pathname === href;
}
