import { backendSupervisorStatus } from "@/lib/backend-supervisor";
import { NextResponse } from "next/server";

export async function GET() {
  const status = await backendSupervisorStatus();
  return NextResponse.json(status);
}
