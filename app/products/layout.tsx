import { AppShell } from "@/components/layout/app-shell";

export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Products">{children}</AppShell>;
}
