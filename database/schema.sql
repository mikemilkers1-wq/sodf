CREATE TABLE IF NOT EXISTS rcso_employees (
  id BIGSERIAL PRIMARY KEY,
  employee_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  validation_code_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('sheriff_admin','supervisor','deputy','dispatcher','read_only')),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rcso_portal_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES rcso_employees(id)
);

CREATE TABLE IF NOT EXISTS rcso_audit_log (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT REFERENCES rcso_employees(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
