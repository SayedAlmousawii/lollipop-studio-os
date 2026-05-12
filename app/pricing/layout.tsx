import { AppShell } from "@/components/layout/app-shell";

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Pricing">{children}</AppShell>;
}
