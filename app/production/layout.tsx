import { AppShell } from "@/components/layout/app-shell";

export default function ProductionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Production">{children}</AppShell>;
}
