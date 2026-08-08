"use client";

// Entscheidet, welche Rahmen-Oberfläche eine Seite bekommt.
//
// Drei Fälle, klar getrennt (Aufgabe 28 - Layout-Trennung vorbereiten, ohne
// eine neue Designarchitektur zu bauen):
//
//   /login          keine Navigation, nur der Inhalt (man ist ja nicht
//                   angemeldet - eine Navigation wäre irreführend)
//   /employee/...   schmale Mitarbeiter-Navigation
//   alles andere    die bestehende Planner-/Admin-Sidebar, unverändert
//
// Bewusst hier und nicht über Route Groups gelöst: die bestehenden Seiten
// bleiben dadurch an ihrem Platz (gleiche Dateien, gleiche URLs, keine
// Massenverschiebung im Verzeichnisbaum) - dieser Sprint soll die
// Sicherheitsarchitektur ändern, nicht die Projektstruktur.

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import EmployeeShell from "./auth/EmployeeShell";
import { EMPLOYEE_HOME, LOGIN_PATH } from "@/lib/auth/route-access";

function isWithin(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isWithin(pathname, LOGIN_PATH)) {
    return <main className="app-main app-main--bare min-w-0 flex-1 overflow-y-auto">{children}</main>;
  }

  if (isWithin(pathname, EMPLOYEE_HOME)) {
    return <EmployeeShell>{children}</EmployeeShell>;
  }

  return (
    <>
      <Sidebar />
      <main className="app-main min-w-0 flex-1 overflow-y-auto px-5 py-5 md:px-8 md:py-6">{children}</main>
    </>
  );
}
