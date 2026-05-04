import { AppShell } from "@/components/layout/app-shell";

export default function BookingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Bookings">{children}</AppShell>;
}
