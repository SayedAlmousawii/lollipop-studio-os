"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

interface SidebarProps {
  showProductionLink: boolean;
  showProductsLink: boolean;
}

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

export function Sidebar({ showProductionLink, showProductsLink }: SidebarProps) {
  const pathname = usePathname();
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
    <aside className="flex h-full w-60 flex-shrink-0 flex-col bg-sidebar">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <Aperture className="h-4 w-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-sidebar-foreground tracking-wide">
          Studio OS
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {navSections.map((section, si) => (
          <div key={si} className={cn("space-y-0.5", si > 0 && "mt-1 pt-1 border-t border-sidebar-border")}>
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-active-bg text-primary font-medium"
                      : "text-sidebar-muted hover:bg-sidebar-active-bg hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User block */}
      <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
          <User className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-sidebar-foreground">
            Studio Admin
          </p>
          <p className="truncate text-xs text-sidebar-muted">Manager</p>
        </div>
      </div>
    </aside>
  );
}
