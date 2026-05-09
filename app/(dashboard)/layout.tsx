import { requireCurrentAppUser } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireCurrentAppUser();
  return <AppShell pageTitle="Dashboard">{children}</AppShell>;
}
