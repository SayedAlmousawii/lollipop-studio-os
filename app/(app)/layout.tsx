import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { SidebarCollapseProvider } from "@/components/layout/sidebar-collapse-provider";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/components/layout/sidebar-collapse-preference";

export default async function ProtectedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "true";

  return (
    <SidebarCollapseProvider defaultCollapsed={sidebarCollapsed}>
      <AppShell>{children}</AppShell>
    </SidebarCollapseProvider>
  );
}
