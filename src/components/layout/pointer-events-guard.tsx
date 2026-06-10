"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { clearStaleBodyPointerEventsLock } from "./pointer-events-guard-utils";

export function PointerEventsGuard() {
  const pathname = usePathname();

  useEffect(() => {
    clearStaleBodyPointerEventsLock();
  }, [pathname]);

  return null;
}
