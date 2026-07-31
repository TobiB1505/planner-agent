import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Planner-Agent",
  description: "Dienstplan-Verwaltung für das Entertainment-Team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="flex h-full min-h-screen overflow-hidden">
        <Sidebar />
        <main className="app-main min-w-0 flex-1 overflow-y-auto px-5 py-5 md:px-8 md:py-6">{children}</main>
      </body>
    </html>
  );
}
