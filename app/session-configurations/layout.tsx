import { AppShell } from "@/components/layout/app-shell";

export default function SessionConfigurationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Session Configurations">{children}</AppShell>;
}
