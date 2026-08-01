import { NextResponse } from "next/server";
import { clearAdminAccess } from "@/lib/auth";
export async function POST() {
  await clearAdminAccess();
  return NextResponse.json({ ok: true });
}
