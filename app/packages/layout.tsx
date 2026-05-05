import { AppShell } from "@/components/layout/app-shell";

export default function PackagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Packages">{children}</AppShell>;
}
