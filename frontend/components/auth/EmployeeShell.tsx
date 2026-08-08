"use client";

// Navigation für den Mitarbeiterbereich.
//
// Bewusst eine eigene, sehr schmale Leiste statt der Planner-Sidebar mit
// ausgeblendeten Einträgen: die beiden Bereiche haben unterschiedliche
// Aufgaben, und eine halb leere Planungsnavigation würde nach "hier fehlt
// etwas" aussehen. Design, Farben und Komponenten bleiben unverändert das
// bestehende Designsystem - kein neuer Look.
//
// Die verlinkten Unterseiten entstehen erst im Employee-Portal-Sprint;
// bis dahin stehen sie als deaktivierte Einträge in der Leiste, damit
// sichtbar ist, wohin es geht.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";

interface EmployeeNavItem {
  href: string;
  label: string;
  /** Noch nicht gebaut - wird als Vorschau angezeigt, ist aber kein Link. */
  upcoming?: boolean;
}

export const EMPLOYEE_NAV_ITEMS: EmployeeNavItem[] = [
  { href: "/employee", label: "Meine Übersicht" },
  { href: "/employee/dienstplan", label: "Mein Dienstplan", upcoming: true },
  { href: "/employee/kuenstlerplan", label: "Künstlerplan", upcoming: true },
  { href: "/employee/probenplan", label: "Probenplan", upcoming: true },
];

export default function EmployeeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut, signingOut } = useAuth();

  return (
    <>
      <aside className="app-sidebar employee-sidebar" aria-label="Mitarbeiter-Navigation">
        <div className="sidebar-brand">
          <div className="sidebar-brand-copy">
            <strong>
              Planner<em>-Agent</em>
            </strong>
            <small>Mitarbeiterbereich</small>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Mitarbeiterbereich">
          {EMPLOYEE_NAV_ITEMS.map((item) =>
            item.upcoming ? (
              <span
                key={item.href}
                className="sidebar-link is-upcoming"
                aria-disabled="true"
                title="Kommt im nächsten Schritt"
              >
                <span className="sidebar-link-label">{item.label}</span>
                <span className="sidebar-link-hint">bald</span>
              </span>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                className={`sidebar-link ${pathname === item.href ? "is-active" : ""}`}
              >
                <span className="sidebar-link-label">{item.label}</span>
              </Link>
            ),
          )}
        </nav>

        <div className="sidebar-account">
          <button
            type="button"
            className="sidebar-link sidebar-link--action"
            onClick={signOut}
            disabled={signingOut}
          >
            <span className="sidebar-link-label">{signingOut ? "Wird abgemeldet…" : "Abmelden"}</span>
          </button>
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-footer-dot" aria-hidden="true" />
          <span className="sidebar-footer-copy">{user?.personName ?? user?.email ?? "Angemeldet"}</span>
        </div>
      </aside>

      <main className="app-main min-w-0 flex-1 overflow-y-auto px-5 py-5 md:px-8 md:py-6">{children}</main>
    </>
  );
}
