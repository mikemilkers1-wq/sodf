import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDatabase } from "@/lib/setup";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  await ensureDatabase();
  const sql = db();
  const rows = await sql`
    SELECT
      id,
      employee_key,
      display_name,
      role,
      status,
      department,
      department_head,
      duty_status,
      profile_photo_data_url,
      biography_text,
      biography_updated_at,
      created_at,
      last_login_at
    FROM rcso_employees
    WHERE status = 'active'
    ORDER BY
      CASE WHEN role = 'sheriff_admin' THEN 0
           WHEN role = 'supervisor' THEN 1
           ELSE 2 END,
      display_name
  `;

  return NextResponse.json({ employees: rows });
}
