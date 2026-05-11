import { Sidebar } from "./sidebar";
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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        showProductionLink={hasPermission(appUser, PERMISSIONS.ORDER_READ)}
        showProductsLink={hasPermission(
          appUser,
          PERMISSIONS.PACKAGE_CATALOG_MANAGE
        )}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar pageTitle={pageTitle} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
