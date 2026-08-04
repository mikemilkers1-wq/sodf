import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

let setupPromise;

export function ensureDatabase() {
  if (!setupPromise) setupPromise = setup();
  return setupPromise;
}

async function setup() {
  const sql = db();

  await sql`CREATE SEQUENCE IF NOT EXISTS county_person_public_id_seq START 1`;
  await sql`
    CREATE TABLE IF NOT EXISTS county_people (
      public_id TEXT PRIMARY KEY DEFAULT (
        'RCP-' || EXTRACT(YEAR FROM NOW())::int::text || '-' ||
        LPAD(nextval('county_person_public_id_seq')::text, 6, '0')
      ),
      legal_first_name TEXT NOT NULL, legal_middle_name TEXT,
      legal_last_name TEXT NOT NULL, suffix TEXT, date_of_birth DATE,
      sex TEXT, height_cm INTEGER, weight_kg INTEGER, eye_color TEXT,
      hair_color TEXT, ssn_last4 TEXT, driver_license_last4 TEXT,
      primary_phone TEXT, primary_email TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      deceased_at DATE, deceased_source TEXT,
      creation_reason TEXT NOT NULL, source_department TEXT NOT NULL,
      source_record TEXT, general_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by_department TEXT NOT NULL,
      created_by_employee_key TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived_at TIMESTAMPTZ, archived_reason TEXT
    )
  `;
  await sql`CREATE TABLE IF NOT EXISTS county_person_aliases (
    id BIGSERIAL PRIMARY KEY, person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
    first_name TEXT, middle_name TEXT, last_name TEXT NOT NULL, alias_type TEXT NOT NULL DEFAULT 'alias',
    verified BOOLEAN NOT NULL DEFAULT FALSE, source TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS county_person_addresses (
    id BIGSERIAL PRIMARY KEY, person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
    line1 TEXT NOT NULL, line2 TEXT, city TEXT NOT NULL, state_code TEXT NOT NULL DEFAULT 'CA',
    postal_code TEXT, address_type TEXT NOT NULL DEFAULT 'residential',
    is_current BOOLEAN NOT NULL DEFAULT TRUE, verified BOOLEAN NOT NULL DEFAULT FALSE,
    valid_from DATE, valid_to DATE, source TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS county_person_photos (
    id BIGSERIAL PRIMARY KEY, person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
    photo_type TEXT NOT NULL, image_data_url TEXT NOT NULL, taken_at TIMESTAMPTZ,
    source_department TEXT NOT NULL, source_record TEXT, uploaded_by_employee_key TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE, is_obsolete BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS county_person_relationships (
    id BIGSERIAL PRIMARY KEY, person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
    related_person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL, relationship_pair_id UUID, verified BOOLEAN NOT NULL DEFAULT FALSE,
    confidence TEXT NOT NULL DEFAULT 'reported', source TEXT,
    effective_from DATE, effective_to DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE county_person_relationships
    ADD COLUMN IF NOT EXISTS relationship_pair_id UUID`;
  await sql`CREATE INDEX IF NOT EXISTS county_person_relationship_pair_idx
    ON county_person_relationships(relationship_pair_id)`;
  await sql`CREATE TABLE IF NOT EXISTS county_person_roles (
    id BIGSERIAL PRIMARY KEY, person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
    role_type TEXT NOT NULL, organization TEXT NOT NULL, title_or_rank TEXT,
    badge_number TEXT, employee_number TEXT, jurisdiction TEXT, political_party TEXT,
    starts_at DATE, ends_at DATE, status TEXT NOT NULL DEFAULT 'active',
    source TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS county_person_events (
    id BIGSERIAL PRIMARY KEY, person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
    event_category TEXT NOT NULL, event_status TEXT, title TEXT NOT NULL,
    occurred_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, department TEXT NOT NULL,
    source_record TEXT, summary TEXT, disposition TEXT,
    restricted BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS county_person_links (
    id BIGSERIAL PRIMARY KEY, person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
    department TEXT NOT NULL, record_type TEXT NOT NULL, record_id TEXT NOT NULL,
    record_status TEXT, summary TEXT, amount NUMERIC(14,2), occurred_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (department, record_type, record_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS county_person_audit (
    id BIGSERIAL PRIMARY KEY, person_id TEXT REFERENCES county_people(public_id) ON DELETE SET NULL,
    department TEXT NOT NULL, employee_key TEXT NOT NULL, action TEXT NOT NULL,
    purpose TEXT, details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;


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

  await sql`ALTER TABLE rcso_employees ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'Field Operations Bureau'`;
  await sql`ALTER TABLE rcso_employees ADD COLUMN IF NOT EXISTS department_head BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE rcso_employees ADD COLUMN IF NOT EXISTS duty_status TEXT NOT NULL DEFAULT 'off_duty'`;
  await sql`ALTER TABLE rcso_employees ADD COLUMN IF NOT EXISTS profile_photo_data_url TEXT`;
  await sql`ALTER TABLE rcso_employees ADD COLUMN IF NOT EXISTS biography_text TEXT`;
  await sql`ALTER TABLE rcso_employees ADD COLUMN IF NOT EXISTS biography_updated_at TIMESTAMPTZ`;

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
