"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ADMIN_NAV_ITEMS, getAdminNavHref, isAdminNavItemActive } from "@/lib/admin/navigation";
import { cn } from "@/lib/utils";

type AdminShellProps = {
  tenantSlug: string;
  tenantName: string;
  children: ReactNode;
};

function navLinkClass(isActive: boolean) {
  return cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-primary/10 text-[var(--tenant-primary)]"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

export function AdminShell({ tenantSlug, tenantName, children }: AdminShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between gap-3">
            <Link
              href={getAdminNavHref(tenantSlug, "dashboard")}
              className="truncate text-lg font-bold"
              style={{ color: "var(--tenant-primary)" }}
            >
              {tenantName}
            </Link>

            <nav className="hidden items-center gap-1 md:flex" aria-label="Admin">
              {ADMIN_NAV_ITEMS.map((item) => {
                const href = getAdminNavHref(tenantSlug, item.segment);
                const isActive = isAdminNavItemActive(pathname, tenantSlug, item);
                return (
                  <Link key={item.key} href={href} className={navLinkClass(isActive)}>
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex size-9 items-center justify-center rounded-md border md:hidden"
                aria-expanded={mobileOpen}
                aria-controls="admin-mobile-nav"
                aria-label={mobileOpen ? "Close admin menu" : "Open admin menu"}
                onClick={() => setMobileOpen((open) => !open)}
              >
                {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
              </button>
              <div
                className="flex size-8 items-center justify-center rounded-full text-sm font-bold text-primary-foreground"
                style={{ backgroundColor: "var(--tenant-primary)" }}
                aria-hidden
              >
                {tenantName.charAt(0)}
              </div>
            </div>
          </div>

          {mobileOpen ? (
            <nav
              id="admin-mobile-nav"
              className="grid gap-1 border-t py-3 md:hidden"
              aria-label="Admin mobile"
            >
              {ADMIN_NAV_ITEMS.map((item) => {
                const href = getAdminNavHref(tenantSlug, item.segment);
                const isActive = isAdminNavItemActive(pathname, tenantSlug, item);
                return (
                  <Link
                    key={item.key}
                    href={href}
                    className={navLinkClass(isActive)}
                    onClick={() => setMobileOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>
      </header>

      {children}
    </div>
  );
}
