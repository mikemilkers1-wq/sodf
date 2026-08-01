import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDatabase } from "@/lib/setup";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabase();
    const employee = await requireSession();
    if (!employee) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

    const sql = db();
    const rows = await sql`SELECT state, version, updated_at FROM rcso_portal_state WHERE id = 1`;
    return NextResponse.json({
      state: rows[0].state,
      version: Number(rows[0].version),
      updatedAt: rows[0].updated_at
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Datenbestand konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    await ensureDatabase();
    const employee = await requireSession();
    if (!employee) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (employee.role === "read_only") {
      return NextResponse.json({ error: "Dieses Konto besitzt nur Leserechte." }, { status: 403 });
    }

    const { state, version, action = "STATE_UPDATED", details = {} } = await request.json();
    const expectedVersion = Number(version);
    const sql = db();

    const rows = await sql`
      UPDATE rcso_portal_state
      SET state = ${JSON.stringify(state)}::jsonb,
          version = version + 1,
          updated_at = NOW(),
          updated_by = ${employee.id}
      WHERE id = 1 AND version = ${expectedVersion}
      RETURNING version
    `;

    if (!rows.length) {
      const current = await sql`SELECT version FROM rcso_portal_state WHERE id = 1`;
      return NextResponse.json({
        error: "Der Datenbestand wurde zwischenzeitlich verändert.",
        currentVersion: Number(current[0]?.version)
      }, { status: 409 });
    }

    await sql`
      INSERT INTO rcso_audit_log (employee_id, action, details)
      VALUES (${employee.id}, ${action}, ${JSON.stringify(details)}::jsonb)
    `;

    return NextResponse.json({ version: Number(rows[0].version) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Datenbestand konnte nicht gespeichert werden." }, { status: 500 });
  }
}
