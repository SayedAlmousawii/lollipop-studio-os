import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="h-full antialiased">
        <ClerkProvider dynamic>
          <PointerEventsGuard />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
