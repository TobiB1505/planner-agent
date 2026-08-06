import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import InternalNavigationGuard from "@/components/InternalNavigationGuard";
import Sidebar from "@/components/Sidebar";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";
import "./styles/foundation.css";
import "./styles/tokens.css";
import "./styles/sidebar.css";
import "./styles/shared-components.css";
import "./styles/planning-workflow.css";
import "./styles/dashboard.css";
import "./styles/category-colors.css";
import "./styles/archive.css";
import "./styles/team.css";
import "./styles/planning-logic.css";
import "./styles/memory.css";
import "./styles/system.css";
import "./styles/plan-editor.css";
import "./styles/intelligence.css";
import "./styles/badges.css";
import "./styles/command-theme.css";
import "./styles/ui-primitives.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Planner-Agent",
    template: "%s | Planner-Agent",
  },
  description: "Dienstplan-Verwaltung für das Entertainment-Team",
  applicationName: "Planner-Agent",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Planner-Agent",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#6c7bff",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`h-full antialiased ${inter.variable} ${jetbrainsMono.variable}`}
      data-theme="command"
    >
      <body className="flex h-full min-h-screen overflow-hidden">
        <ToastProvider>
          <InternalNavigationGuard />
          <Sidebar />
          <main className="app-main min-w-0 flex-1 overflow-y-auto px-5 py-5 md:px-8 md:py-6">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
