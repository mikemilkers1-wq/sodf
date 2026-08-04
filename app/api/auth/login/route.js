import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDatabase } from "@/lib/setup";
import { createSession } from "@/lib/auth";

export async function POST(request) {
  try {
    await ensureDatabase();
    const { employeeKey, validationCode } = await request.json();

    if (!employeeKey?.trim() || !validationCode) {
      return NextResponse.json({ error: "Mitarbeiterkennung und Validierungscode sind erforderlich." }, { status: 400 });
    }

    const sql = db();
    const rows = await sql`
      SELECT id, employee_key, display_name, validation_code_hash, role, status, department, department_head, duty_status
      FROM rcso_employees
      WHERE LOWER(employee_key) = LOWER(${employeeKey.trim()})
      LIMIT 1
    `;

    const employee = rows[0];
    if (!employee || employee.status !== "active") {
      return NextResponse.json({ error: "Mitarbeiterkonto nicht gefunden oder deaktiviert." }, { status: 401 });
    }

    const valid = await bcrypt.compare(validationCode, employee.validation_code_hash);
    if (!valid) {
      return NextResponse.json({ error: "Ungültiger Validierungscode." }, { status: 401 });
    }

    await createSession(employee);
    await sql`
      UPDATE rcso_employees
      SET last_login_at = NOW()
      WHERE id = ${employee.id}
    `;
    await sql`
      INSERT INTO rcso_audit_log (employee_id, action, details)
      VALUES (${employee.id}, 'LOGIN', '{}'::jsonb)
    `;

    return NextResponse.json({
      employee: {
        id: employee.id,
        employeeKey: employee.employee_key,
        displayName: employee.display_name,
        role: employee.role,
        department: employee.department,
        departmentHead: employee.department_head,
        dutyStatus: employee.duty_status
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Anmeldung konnte nicht verarbeitet werden." }, { status: 500 });
  }
}
