import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import { SidebarCollapseProvider } from "@/components/layout/sidebar-collapse-provider";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/components/layout/sidebar-collapse-preference";
import { PointerEventsGuard } from "@/components/layout/pointer-events-guard";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Studio OS",
  description: "Photography studio operations system",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "true";

  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="h-full antialiased">
        <ClerkProvider dynamic>
          <SidebarCollapseProvider defaultCollapsed={sidebarCollapsed}>
            <PointerEventsGuard />
            {children}
          </SidebarCollapseProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
