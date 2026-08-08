import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import InternalNavigationGuard from "@/components/InternalNavigationGuard";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { getAppUser } from "@/lib/auth/app-user";
import { PATHNAME_HEADER, resolveRouteAccess } from "@/lib/auth/route-access";
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
import "./styles/auth.css";

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

/**
 * Auth-Sprint: das Layout ist die serverseitige Rollen-Schranke der
 * Oberfläche.
 *
 * Ablauf pro Seitenaufbau:
 *   1. Pfad aus dem von proxy.ts gesetzten Header lesen,
 *   2. Benutzer + Rolle einmalig von FastAPI holen (GET /api/auth/me),
 *   3. anhand derselben Regeln wie im Proxy entscheiden: anzeigen oder
 *      umleiten.
 *
 * Warum hier und nicht im Proxy: der Proxy läuft bei jeder Navigation und
 * bei jedem Prefetch: dort einen Backend-Aufruf zu machen, rät die
 * Next.js-Dokumentation ausdrücklich ab. Der Proxy prüft deshalb nur
 * "angemeldet ja/nein", die Rolle wird genau einmal pro Seitenaufbau
 * geprüft - serverseitig, bevor irgendetwas gerendert wird.
 *
 * Und noch einmal, weil es der Kern dieses Sprints ist: das ist
 * Benutzerführung, keine Autorisierung. Die Daten liegen hinter FastAPI, und
 * dort wird jede einzelne Anfrage unabhängig geprüft.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get(PATHNAME_HEADER) ?? "/";
  const appUser = await getAppUser();

  const decision = resolveRouteAccess({ pathname, role: appUser?.role ?? null });
  if (decision.type === "redirect") {
    redirect(decision.to);
  }

  return (
    <html
      lang="de"
      className={`h-full antialiased ${inter.variable} ${jetbrainsMono.variable}`}
      data-theme="command"
    >
      <body className="flex h-full min-h-screen overflow-hidden">
        <AuthProvider initialUser={appUser}>
          <ToastProvider>
            <InternalNavigationGuard />
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
