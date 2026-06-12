import { cookies } from "next/headers";
import { Sidebar, SIDEBAR_COLLAPSED_COOKIE } from "./sidebar";
import { Topbar } from "./topbar";
import { requireCurrentAppUser } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

interface AppShellProps {
  children: React.ReactNode;
  pageTitle?: string;
}

export async function AppShell({
  children,
  pageTitle = "Dashboard",
}: AppShellProps) {
  const appUser = await requireCurrentAppUser();
  // Read the persisted collapsed preference server-side so the sidebar renders
  // at its correct width on first paint, even though it remounts on every
  // cross-section navigation (AppShell is per route-section layout).
  const cookieStore = await cookies();
  const sidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "true";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        showProductionLink={hasPermission(appUser, PERMISSIONS.ORDER_READ)}
        showProductsLink={hasPermission(
          appUser,
          PERMISSIONS.PACKAGE_CATALOG_MANAGE
        )}
        defaultCollapsed={sidebarCollapsed}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar pageTitle={pageTitle} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
