"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  SIDEBAR_COLLAPSED_COOKIE_MAX_AGE_SECONDS,
} from "./sidebar-collapse-preference";

interface SidebarCollapseContextValue {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
}

const SidebarCollapseContext =
  createContext<SidebarCollapseContextValue | null>(null);

interface SidebarCollapseProviderProps {
  children: ReactNode;
  defaultCollapsed: boolean;
}

function persistSidebarCollapsedCookie(collapsed: boolean) {
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed}; path=/; max-age=${SIDEBAR_COLLAPSED_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function SidebarCollapseProvider({
  children,
  defaultCollapsed,
}: SidebarCollapseProviderProps) {
  const [collapsed, setCollapsedState] = useState(defaultCollapsed);

  const setCollapsed = useCallback((next: boolean) => {
    persistSidebarCollapsedCookie(next);
    setCollapsedState(next);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((current) => {
      const next = !current;
      persistSidebarCollapsedCookie(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ collapsed, setCollapsed, toggleCollapsed }),
    [collapsed, setCollapsed, toggleCollapsed]
  );

  return (
    <SidebarCollapseContext.Provider value={value}>
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse() {
  const context = useContext(SidebarCollapseContext);

  if (!context) {
    throw new Error("useSidebarCollapse must be used within SidebarCollapseProvider");
  }

  return context;
}
