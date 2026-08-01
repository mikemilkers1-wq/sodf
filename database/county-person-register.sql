-- Riverside County Shared Person Register v0.1.0
-- Run once in the Neon database used by every connected department.
-- Safe to run repeatedly.

CREATE SEQUENCE IF NOT EXISTS county_person_public_id_seq START 1;

CREATE TABLE IF NOT EXISTS county_people (
  public_id TEXT PRIMARY KEY DEFAULT (
    'RCP-' || EXTRACT(YEAR FROM NOW())::int::text || '-' ||
    LPAD(nextval('county_person_public_id_seq')::text, 6, '0')
  ),
  legal_first_name TEXT NOT NULL,
  legal_middle_name TEXT,
  legal_last_name TEXT NOT NULL,
  suffix TEXT,
  date_of_birth DATE,
  sex TEXT,
  height_cm INTEGER,
  weight_kg INTEGER,
  eye_color TEXT,
  hair_color TEXT,
  ssn_last4 TEXT,
  driver_license_last4 TEXT,
  primary_phone TEXT,
  primary_email TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived','deceased','restricted')),
  deceased_at DATE,
  deceased_source TEXT,
  creation_reason TEXT NOT NULL,
  source_department TEXT NOT NULL,
  source_record TEXT,
  general_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_department TEXT NOT NULL,
  created_by_employee_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  archived_reason TEXT
);

CREATE INDEX IF NOT EXISTS county_people_name_idx
  ON county_people (LOWER(legal_last_name), LOWER(legal_first_name));
CREATE INDEX IF NOT EXISTS county_people_dob_idx ON county_people(date_of_birth);
CREATE INDEX IF NOT EXISTS county_people_status_idx ON county_people(status);

CREATE TABLE IF NOT EXISTS county_person_aliases (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'alias',
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS county_person_addresses (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state_code TEXT NOT NULL DEFAULT 'CA',
  postal_code TEXT,
  address_type TEXT NOT NULL DEFAULT 'residential',
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from DATE,
  valid_to DATE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS county_person_address_search_idx
  ON county_person_addresses (LOWER(line1), LOWER(city), postal_code);

CREATE TABLE IF NOT EXISTS county_person_photos (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
  photo_type TEXT NOT NULL CHECK (photo_type IN ('mugshot','identification','evidence','other')),
  image_data_url TEXT NOT NULL,
  taken_at TIMESTAMPTZ,
  source_department TEXT NOT NULL,
  source_record TEXT,
  uploaded_by_employee_key TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_obsolete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS county_person_relationships (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
  related_person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  relationship_pair_id UUID,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  confidence TEXT NOT NULL DEFAULT 'reported',
  source TEXT,
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (person_id <> related_person_id)
);

CREATE TABLE IF NOT EXISTS county_person_roles (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
  role_type TEXT NOT NULL CHECK (role_type IN (
    'law_enforcement','government_employee','elected_official',
    'appointed_official','military','other'
  )),
  organization TEXT NOT NULL,
  title_or_rank TEXT,
  badge_number TEXT,
  employee_number TEXT,
  jurisdiction TEXT,
  political_party TEXT,
  starts_at DATE,
  ends_at DATE,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS county_person_badge_idx ON county_person_roles(badge_number);

CREATE TABLE IF NOT EXISTS county_person_events (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
  event_category TEXT NOT NULL CHECK (event_category IN (
    'questioning','citation','incident','complaint','arrest','charge',
    'court_disposition','conviction','acquittal','dismissal',
    'jail_booking','jail_release','prison_admission','prison_release',
    'parole','probation','other'
  )),
  event_status TEXT,
  title TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  department TEXT NOT NULL,
  source_record TEXT,
  summary TEXT,
  disposition TEXT,
  restricted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS county_person_events_person_idx ON county_person_events(person_id);
CREATE INDEX IF NOT EXISTS county_person_events_category_idx ON county_person_events(event_category);

CREATE TABLE IF NOT EXISTS county_person_links (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES county_people(public_id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  record_status TEXT,
  summary TEXT,
  amount NUMERIC(14,2),
  occurred_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department, record_type, record_id)
);
CREATE INDEX IF NOT EXISTS county_person_links_person_idx ON county_person_links(person_id);
CREATE INDEX IF NOT EXISTS county_person_links_record_idx
  ON county_person_links(department, record_type, record_id);

CREATE TABLE IF NOT EXISTS county_person_audit (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT REFERENCES county_people(public_id) ON DELETE SET NULL,
  department TEXT NOT NULL,
  employee_key TEXT NOT NULL,
  action TEXT NOT NULL,
  purpose TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS county_person_audit_person_idx ON county_person_audit(person_id);

CREATE INDEX IF NOT EXISTS county_person_relationship_pair_idx
  ON county_person_relationships(relationship_pair_id);
