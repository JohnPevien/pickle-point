import { describe, expect, test } from "vitest";
import { ADMIN_NAV_ITEMS, getAdminNavHref, isAdminNavItemActive } from "./navigation";

describe("admin navigation", () => {
  const tenant = "tenant_123";

  test("builds tenant-scoped admin hrefs", () => {
    expect(getAdminNavHref(tenant, "players")).toBe("/tenant_123/admin/players");
  });

  test("marks only the dashboard route as active on the dashboard path", () => {
    const pathname = "/tenant_123/admin/dashboard";

    expect(isAdminNavItemActive(pathname, tenant, ADMIN_NAV_ITEMS[0])).toBe(true);
    expect(isAdminNavItemActive(pathname, tenant, ADMIN_NAV_ITEMS[1])).toBe(false);
  });

  test("marks tournament detail routes as active for tournaments nav", () => {
    const pathname = "/tenant_123/admin/tournaments/tournament_456";
    const tournaments = ADMIN_NAV_ITEMS.find((item) => item.key === "tournaments");

    expect(tournaments).toBeDefined();
    expect(isAdminNavItemActive(pathname, tenant, tournaments!)).toBe(true);
    expect(isAdminNavItemActive(pathname, tenant, ADMIN_NAV_ITEMS[0])).toBe(false);
  });

  test("does not mark sibling admin routes as active", () => {
    const pathname = "/tenant_123/admin/venues";

    expect(isAdminNavItemActive(pathname, tenant, ADMIN_NAV_ITEMS.find((item) => item.key === "venues")!)).toBe(
      true,
    );
    expect(isAdminNavItemActive(pathname, tenant, ADMIN_NAV_ITEMS.find((item) => item.key === "players")!)).toBe(
      false,
    );
  });
});
