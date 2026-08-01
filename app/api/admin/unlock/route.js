import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireSession, createAdminAccess } from "@/lib/auth";

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function POST(request) {
  try {
    const employee = await requireSession();
    if (!employee || employee.role !== "sheriff_admin") {
      return NextResponse.json({ error: "Nur ein Sheriff Administrator kann das Admin-Menü entsperren." }, { status: 403 });
    }
    const { adminCode } = await request.json();
    const expected = process.env.RCSO_INITIAL_ADMIN_CODE;
    if (!expected) return NextResponse.json({ error: "RCSO_INITIAL_ADMIN_CODE ist nicht konfiguriert." }, { status: 500 });
    if (!safeEqual(adminCode || "", expected)) {
      return NextResponse.json({ error: "Ungültiger Administrationscode." }, { status: 401 });
    }
    await createAdminAccess();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Admin-Zugang konnte nicht geprüft werden." }, { status: 500 });
  }
}
