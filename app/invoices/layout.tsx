import { AppShell } from "@/components/layout/app-shell";

export default function InvoicesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Invoices">{children}</AppShell>;
}
