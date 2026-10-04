-- Approved member-visible content is separate from the editable catalog.
-- Dates describe a release; they never grant visibility or trigger publication.
CREATE TABLE veiling_publications (
  veiling_id TEXT PRIMARY KEY REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(description) <= 20000),
  character_number INTEGER UNIQUE CHECK (character_number IS NULL OR character_number BETWEEN 1 AND 999999),
  rarity TEXT CHECK (rarity IS NULL OR length(rarity) BETWEEN 1 AND 80),
  edition TEXT CHECK (edition IS NULL OR length(edition) BETWEEN 1 AND 120),
  artwork_id TEXT REFERENCES artwork(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'upcoming')),
  release_date TEXT CHECK (release_date IS NULL OR (visibility = 'upcoming' AND length(release_date) = 10)),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  updated_at INTEGER NOT NULL
);
CREATE INDEX veiling_publications_order ON veiling_publications(visibility, character_number, veiling_id);

CREATE TABLE publication_audit (
  id TEXT PRIMARY KEY,
  veiling_id TEXT NOT NULL REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('approve_draft', 'change_visibility', 'hide')),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  catalog_revision INTEGER NOT NULL CHECK (catalog_revision >= 2),
  created_at INTEGER NOT NULL
);
CREATE INDEX publication_audit_veiling ON publication_audit(veiling_id, created_at, id);
CREATE TRIGGER publication_audit_no_update BEFORE UPDATE ON publication_audit BEGIN SELECT RAISE(ABORT, 'publication audit is append-only'); END;
CREATE TRIGGER publication_audit_no_delete BEFORE DELETE ON publication_audit BEGIN SELECT RAISE(ABORT, 'publication audit is append-only'); END;
