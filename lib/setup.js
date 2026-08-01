import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

let setupPromise;

export function ensureDatabase() {
  if (!setupPromise) setupPromise = setup();
  return setupPromise;
}

async function setup() {
  const sql = db();

  await sql`
    CREATE TABLE IF NOT EXISTS rcso_employees (
      id BIGSERIAL PRIMARY KEY,
      employee_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      validation_code_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('sheriff_admin','supervisor','deputy','dispatcher','read_only')),
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rcso_portal_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state JSONB NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by BIGINT REFERENCES rcso_employees(id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rcso_audit_log (
      id BIGSERIAL PRIMARY KEY,
      employee_id BIGINT REFERENCES rcso_employees(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const employeeCount = await sql`SELECT COUNT(*)::int AS count FROM rcso_employees`;
  if (Number(employeeCount[0]?.count || 0) === 0) {
    const initialCode = process.env.RCSO_INITIAL_ADMIN_CODE || "CHANGE-ME-1234";
    const hash = await bcrypt.hash(initialCode, 12);
    await sql`
      INSERT INTO rcso_employees (employee_key, display_name, validation_code_hash, role)
      VALUES ('Sheriff 1001', 'County Sheriff', ${hash}, 'sheriff_admin')
    `;
  }

  const stateCount = await sql`SELECT COUNT(*)::int AS count FROM rcso_portal_state`;
  if (Number(stateCount[0]?.count || 0) === 0) {
    const initialState = {
      version: 1,
      bolos: [],
      files: [],
      arrests: [],
      complaints: [],
      notices: []
    };
    await sql`
      INSERT INTO rcso_portal_state (id, state, version)
      VALUES (1, ${JSON.stringify(initialState)}::jsonb, 1)
    `;
  }
}
