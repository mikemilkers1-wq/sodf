-- RinCEN v1.0.7 reciprocal relationships migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE county_person_relationships
  ADD COLUMN IF NOT EXISTS relationship_pair_id UUID;

CREATE INDEX IF NOT EXISTS county_person_relationship_pair_idx
  ON county_person_relationships(relationship_pair_id);
