"use client";

import { usePathname } from "next/navigation";

const SECTION_TITLES = [
  ["/session-configurations", "Session Configurations"],
  ["/session-types", "Session Types"],
  ["/bookings", "Bookings"],
  ["/calendar", "Calendar"],
  ["/customers", "Customers"],
  ["/editing", "Editing"],
  ["/invoices", "Invoices"],
  ["/orders", "Orders"],
  ["/packages", "Packages"],
  ["/pricing", "Pricing"],
  ["/production", "Production"],
  ["/products", "Products"],
] as const;

function getTopbarTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";

  const match = SECTION_TITLES.reduce<(typeof SECTION_TITLES)[number] | null>(
    (best, titleEntry) => {
      const [prefix] = titleEntry;

      if (pathname !== prefix && !pathname.startsWith(prefix + "/")) {
        return best;
      }

      return best === null || prefix.length > best[0].length ? titleEntry : best;
    },
    null
  );

  return match?.[1] ?? "Dashboard";
}

export function TopbarTitle() {
  const pathname = usePathname();

  return <>{getTopbarTitle(pathname)}</>;
}
