import { AppShell } from "@/components/layout/app-shell";

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Calendar">{children}</AppShell>;
}