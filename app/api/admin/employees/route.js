import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDatabase } from "@/lib/setup";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const employee = await requireSession();
  if (!employee || employee.role !== "sheriff_admin") return null;
  return employee;
}

export async function GET() {
  try {
    await ensureDatabase();
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Nur der Sheriff-Administrator hat Zugriff." }, { status: 403 });

    const sql = db();
    const employees = await sql`
      SELECT id, employee_key, display_name, role, status, created_at, last_login_at
      FROM rcso_employees
      ORDER BY display_name
    `;
    return NextResponse.json({ employees });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Mitarbeiterliste konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await ensureDatabase();
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Nur der Sheriff-Administrator hat Zugriff." }, { status: 403 });

    const { employeeKey, displayName, validationCode, role } = await request.json();
    if (!employeeKey?.trim() || !displayName?.trim() || !validationCode || validationCode.length < 8) {
      return NextResponse.json({ error: "Alle Felder sind erforderlich; der Code muss mindestens 8 Zeichen haben." }, { status: 400 });
    }

    const allowed = new Set(["sheriff_admin", "supervisor", "deputy", "dispatcher", "read_only"]);
    if (!allowed.has(role)) return NextResponse.json({ error: "Ungültige Rolle." }, { status: 400 });

    const sql = db();
    const hash = await bcrypt.hash(validationCode, 12);
    const rows = await sql`
      INSERT INTO rcso_employees (employee_key, display_name, validation_code_hash, role)
      VALUES (${employeeKey.trim()}, ${displayName.trim()}, ${hash}, ${role})
      RETURNING id, employee_key, display_name, role, status, created_at, last_login_at
    `;

    await sql`
      INSERT INTO rcso_audit_log (employee_id, action, details)
      VALUES (${admin.id}, 'EMPLOYEE_CREATED', ${JSON.stringify({ employeeId: rows[0].id, employeeKey: rows[0].employee_key, role })}::jsonb)
    `;

    return NextResponse.json({ employee: rows[0] }, { status: 201 });
  } catch (error) {
    console.error(error);
    if (String(error?.message || "").toLowerCase().includes("unique")) {
      return NextResponse.json({ error: "Diese Mitarbeiterkennung existiert bereits." }, { status: 409 });
    }
    return NextResponse.json({ error: "Mitarbeiterkonto konnte nicht angelegt werden." }, { status: 500 });
  }
}
