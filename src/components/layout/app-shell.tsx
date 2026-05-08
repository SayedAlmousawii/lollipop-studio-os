import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { requireCurrentAppUser } from "@/lib/auth";

interface AppShellProps {
  children: React.ReactNode;
  pageTitle?: string;
}

export async function AppShell({
  children,
  pageTitle = "Dashboard",
}: AppShellProps) {
  await requireCurrentAppUser();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar pageTitle={pageTitle} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
