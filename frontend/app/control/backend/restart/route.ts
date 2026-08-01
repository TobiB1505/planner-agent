// Bewusst ausserhalb von /api/ (next.config.ts leitet nur /api/:path* an
// FastAPI weiter) - dieser Endpunkt wird von Next.js selbst beantwortet,
// nicht vom Backend, damit er auch funktioniert, wenn das Backend gerade
// nicht läuft.
import { ensureBackendRestarted } from "@/lib/backend-supervisor";
import { NextResponse } from "next/server";

export async function POST() {
  const result = await ensureBackendRestarted();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
