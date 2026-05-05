import { AppShell } from "@/components/layout/app-shell";

export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Orders">{children}</AppShell>;
}
