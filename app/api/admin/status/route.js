import { NextResponse } from "next/server";
import { requireSession, hasAdminAccess } from "@/lib/auth";
export async function GET() {
  const employee = await requireSession();
  if (!employee || employee.role !== "sheriff_admin") return NextResponse.json({ unlocked: false });
  return NextResponse.json({ unlocked: await hasAdminAccess() });
}
