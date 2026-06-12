"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Aperture,
  BarChart2,
  Calendar,
  CalendarCheck,
  Camera,
  DollarSign,
  FileText,
  Image,
  LayoutDashboard,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Printer,
  ReceiptText,
  Settings,
  Tags,
  Truck,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarProps {
  showProductionLink: boolean;
  showProductsLink: boolean;
  defaultCollapsed?: boolean;
}

// Persisted in a cookie (not localStorage) so the server can read it during
// SSR and render the correct width on first paint. AppShell is mounted per
// route-section layout, so the sidebar remounts on every cross-section
// navigation; without an SSR-known initial value it would flash expanded for a
// frame before a post-mount read re-collapsed it. The cookie removes that flash.
export const SIDEBAR_COLLAPSED_COOKIE = "studio-os.sidebar-collapsed";
const SIDEBAR_COLLAPSED_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const NAV_SECTIONS = [
  {
    items: [{ label: "Dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    items: [
      { label: "Bookings", href: "/bookings", icon: CalendarCheck },
      { label: "Calendar", href: "/calendar", icon: Calendar },
      { label: "Customers", href: "/customers", icon: Users },
      { label: "Orders", href: "/orders", icon: ReceiptText },
      { label: "Packages", href: "/packages", icon: Package },
      { label: "Invoices", href: "/invoices", icon: FileText },
    ],
  },
  {
    items: [
      { label: "Sessions", href: "/sessions", icon: Camera },
      { label: "Selection", href: "/selection", icon: Image },
      { label: "Editing", href: "/editing", icon: PenLine },
      { label: "Delivery", href: "/delivery", icon: Truck },
    ],
  },
  {
    items: [
      { label: "Commissions", href: "/commissions", icon: DollarSign },
      { label: "Reports", href: "/reports", icon: BarChart2 },
    ],
  },
  {
    items: [{ label: "Settings", href: "/settings", icon: Settings }],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  showProductionLink,
  showProductsLink,
  defaultCollapsed = false,
}: SidebarProps) {
  const pathname = usePathname();
  // Seeded from the SSR-read cookie so server and first client render agree —
  // no post-mount correction, no hydration mismatch, no expand→collapse flash.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;

      if (typeof document !== "undefined") {
        document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next}; path=/; max-age=${SIDEBAR_COLLAPSED_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
      }

      return next;
    });
  }

  const navSections = NAV_SECTIONS.map((section, index) => {
    if (index === 1 && showProductsLink) {
      const packageIndex = section.items.findIndex(
        (item) => item.href === "/packages"
      );
      return {
        ...section,
        items: [
          ...section.items.slice(0, packageIndex + 1),
          { label: "Session Types", href: "/session-types", icon: Camera },
          {
            label: "Session Configs",
            href: "/session-configurations",
            icon: Settings,
          },
          { label: "Products", href: "/products", icon: Image },
          { label: "Pricing", href: "/pricing", icon: Tags },
          ...section.items.slice(packageIndex + 1),
        ],
      };
    }

    if (index === 2 && showProductionLink) {
      return {
        ...section,
        items: [
          ...section.items.slice(0, 3),
          { label: "Production", href: "/production", icon: Printer },
          ...section.items.slice(3),
        ],
      };
    }

    return section;
  });

  return (
    <aside
      className={cn(
        "flex h-full flex-shrink-0 flex-col bg-sidebar transition-[width] duration-200 ease-in-out",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-sidebar-border px-4",
          collapsed ? "justify-center px-3" : "gap-2.5"
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center",
            collapsed ? "justify-center" : "flex-1 gap-2.5"
          )}
        >
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary">
            <Aperture className="h-4 w-4 text-white" />
          </div>
          <span
            className={cn(
              "text-sm font-semibold tracking-wide text-sidebar-foreground",
              collapsed && "sr-only"
            )}
          >
            Studio OS
          </span>
        </div>

        {collapsed ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-sidebar-muted hover:bg-sidebar-active-bg hover:text-sidebar-foreground"
            aria-label="Collapse sidebar"
            aria-expanded
            onClick={toggleCollapsed}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <TooltipProvider delayDuration={150}>
        <nav className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
          {navSections.map((section, si) => (
            <div
              key={si}
              className={cn(
                "space-y-0.5",
                si > 0 && "mt-1 border-t border-sidebar-border pt-1"
              )}
            >
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                const link = (
                  <Link
                    href={item.href}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center rounded-md text-sm transition-colors",
                      collapsed
                        ? "h-10 justify-center px-0"
                        : "gap-2.5 px-3 py-2",
                      active
                        ? "bg-sidebar-active-bg font-medium text-primary"
                        : "text-sidebar-muted hover:bg-sidebar-active-bg hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className={cn(collapsed && "sr-only")}>
                      {item.label}
                    </span>
                  </Link>
                );

                if (collapsed) {
                  return (
                    <Tooltip key={item.href}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  );
                }

                return (
                  <div key={item.href}>
                    {link}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
      </TooltipProvider>

      {collapsed ? (
        <div className="border-t border-sidebar-border px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-sidebar-muted hover:bg-sidebar-active-bg hover:text-sidebar-foreground"
            aria-label="Expand sidebar"
            aria-expanded={false}
            onClick={toggleCollapsed}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {/* User block */}
      <div
        className={cn(
          "flex items-center border-t border-sidebar-border py-3",
          collapsed ? "justify-center px-3" : "gap-3 px-4"
        )}
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
          <User className="h-4 w-4" />
        </div>
        <div className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
          <p className="truncate text-sm font-medium text-sidebar-foreground">
            Studio Admin
          </p>
          <p className="truncate text-xs text-sidebar-muted">Manager</p>
        </div>
      </div>
    </aside>
  );
}
