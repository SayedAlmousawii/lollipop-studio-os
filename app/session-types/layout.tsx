import { AppShell } from "@/components/layout/app-shell";

export default function SessionTypesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Session Types">{children}</AppShell>;
}
