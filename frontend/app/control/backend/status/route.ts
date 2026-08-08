// Statusabfrage des lokalen Backend-Prozesses (von Next.js selbst
// beantwortet, siehe ../restart/route.ts).
//
// Auth-Sprint: ADMIN. Die Antwort beschreibt den Zustand eines Serverprozesses -
// dieselbe Kategorie von Betriebswissen wie /api/system/diagnostics und
// damit dieselbe Einstufung.
import { backendSupervisorStatus } from "@/lib/backend-supervisor";
import { guardRouteHandler } from "@/lib/auth/route-handler-guard";
import { NextResponse } from "next/server";

export async function GET() {
  const denied = await guardRouteHandler("admin");
  if (denied) return denied.response;

  const status = await backendSupervisorStatus();
  return NextResponse.json(status);
}
