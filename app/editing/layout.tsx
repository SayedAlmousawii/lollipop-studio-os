import { AppShell } from "@/components/layout/app-shell";

export default function EditingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell pageTitle="Editing">{children}</AppShell>;
}
