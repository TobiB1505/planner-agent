"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PRIMARY_NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/plan-editor", label: "Dienstplan erstellen", icon: PlanIcon },
  { href: "/artist-plan", label: "Künstlerplan", icon: ArtistIcon },
  { href: "/rehearsal-plan", label: "Probenplan", icon: RehearsalIcon },
];

const MANAGEMENT_NAV_ITEMS = [
  { href: "/team", label: "Team", icon: TeamIcon },
  { href: "/gedaechtnis", label: "MA-Gedächtnis", icon: MemoryIcon },
  { href: "/planning-logic", label: "Planungslogik", icon: LogicIcon },
  { href: "/archiv", label: "Archiv", icon: ArchiveIcon },
  { href: "/system", label: "System", icon: SystemIcon },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = localStorage.getItem("dienstplan-sidebar-collapsed");
      setCollapsed(stored === null
        ? window.matchMedia("(max-width: 760px)").matches
        : stored === "true");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem("dienstplan-sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <aside
      className={`app-sidebar ${collapsed ? "is-collapsed" : ""}`}
      aria-label="Hauptnavigation"
    >
      <div className="sidebar-brand">
        <button
          type="button"
          className="sidebar-brand-toggle"
          onClick={toggle}
          aria-label={collapsed ? "Navigation ausklappen" : "Navigation einklappen"}
          aria-expanded={!collapsed}
          title={collapsed ? "Navigation ausklappen" : "Navigation einklappen"}
        >
          <LogoGrid />
        </button>
        <div className="sidebar-brand-copy">
          <strong>Planner<em>-Agent</em></strong>
          <small>Dienstplan-Verwaltung</small>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Planung">
        {PRIMARY_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              data-tooltip={collapsed ? label : undefined}
              className={`sidebar-link ${active ? "is-active" : ""}`}
            >
              <span className="sidebar-link-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="sidebar-link-label">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-section-label" aria-hidden="true">
        <span>Verwaltung</span>
        <i />
      </div>

      <nav className="sidebar-nav" aria-label="Verwaltung">
        {MANAGEMENT_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              data-tooltip={collapsed ? label : undefined}
              className={`sidebar-link ${active ? "is-active" : ""}`}
            >
              <span className="sidebar-link-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="sidebar-link-label">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer" aria-hidden="true">
        <span className="sidebar-footer-dot" />
        <span className="sidebar-footer-copy">Lokale Planung</span>
      </div>
    </aside>
  );
}

function LogoGrid() {
  return (
    <span className="sidebar-logo-grid" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
    </span>
  );
}

function DashboardIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" {...props}>
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9.2V21h13V9.2" />
      <path d="M9.5 21v-6.5h5V21" />
    </svg>
  );
}
function TeamIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="8.5" r="2.6" />
      <path d="M15.5 14.2c2.4.5 4.5 2.6 4.5 5.8" />
    </svg>
  );
}
function PlanIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 3v3M16 3v3" />
      <path d="M7 13h3M7 17h5" />
    </svg>
  );
}
function ArtistIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M7 21v-2a5 5 0 0 1 10 0v2" />
      <path d="M4 5h3M17 5h3M5.5 2.5l2 2M18.5 2.5l-2 2" />
    </svg>
  );
}
function RehearsalIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M4 5h16v14H4z" />
      <path d="M8 3v4M16 3v4M4 9h16" />
      <path d="m9 15 2 2 4-5" />
    </svg>
  );
}
function ArchiveIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

function LogicIcon() {
  return <span className="sidebar-logic-glyph" aria-hidden="true">⌁</span>;
}

function MemoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9.5 4.5a3 3 0 0 0-3 3 2.8 2.8 0 0 0-1.5 5 2.8 2.8 0 0 0 1.7 5.1 2.8 2.8 0 0 0 5.3-1.3V6.9a2.4 2.4 0 0 0-2.5-2.4Z" />
      <path d="M14.5 4.5a3 3 0 0 1 3 3 2.8 2.8 0 0 1 1.5 5 2.8 2.8 0 0 1-1.7 5.1 2.8 2.8 0 0 1-5.3-1.3V6.9a2.4 2.4 0 0 1 2.5-2.4Z" />
    </svg>
  );
}

function SystemIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M21 12h-2.5M5.5 12H3M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4 5.6 5.6" />
    </svg>
  );
}
