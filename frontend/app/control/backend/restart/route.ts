// Bewusst ausserhalb von /api/ (next.config.ts leitet nur /api/:path* an
// FastAPI weiter) - dieser Endpunkt wird von Next.js selbst beantwortet,
// nicht vom Backend, damit er auch funktioniert, wenn das Backend gerade
// nicht läuft.
//
// Auth-Sprint: genau deshalb braucht er eine eigene Rollenprüfung. Ein
// Prozessneustart ist eine administrative Systemaktion - dass sie hier an
// FastAPI vorbeiläuft, darf nicht bedeuten, dass sie auch an der
// Berechtigungsprüfung vorbeiläuft.
import { ensureBackendRestarted } from "@/lib/backend-supervisor";
import { guardRouteHandler } from "@/lib/auth/route-handler-guard";
import { NextResponse } from "next/server";

export async function POST() {
  const denied = await guardRouteHandler("admin");
  if (denied) return denied.response;

  const result = await ensureBackendRestarted();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
