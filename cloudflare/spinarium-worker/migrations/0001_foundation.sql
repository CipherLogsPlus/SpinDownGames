-- Spinarium's authoritative SQLite foundation. This is independent of the
-- retired PostgreSQL groundwork. All browser access is through the Worker.
-- No sample catalog, ownership, claim credentials, or administrators are seeded.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  oidc_issuer TEXT NOT NULL,
  oidc_subject TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE oidc_attempts (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX oidc_attempts_expiry ON oidc_attempts(expires_at);

CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL CHECK (hits >= 1),
  window_start INTEGER NOT NULL
);

-- Trusted operators add/remove stable user IDs through controlled D1 access.
-- No account, OIDC claim, email address, or browser API can grant this authority.
CREATE TABLE admin_allowlist (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL CHECK (length(granted_by) BETWEEN 1 AND 120)
);

CREATE TABLE catalog_veilings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  character_number INTEGER UNIQUE CHECK (character_number IS NULL OR character_number BETWEEN 1 AND 999999),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  rarity TEXT CHECK (rarity IS NULL OR length(rarity) BETWEEN 1 AND 80),
  edition TEXT CHECK (edition IS NULL OR length(edition) BETWEEN 1 AND 120),
  artwork_id TEXT REFERENCES artwork(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX catalog_veilings_order ON catalog_veilings(character_number, created_at);

-- Immutable object metadata; the bucket is private and object keys never appear
-- in browser projections. A new upload adds a record instead of overwriting.
CREATE TABLE artwork (
  id TEXT PRIMARY KEY,
  veiling_id TEXT NOT NULL REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);
CREATE INDEX artwork_veiling ON artwork(veiling_id);

CREATE TABLE catalog_audit (
  id TEXT PRIMARY KEY,
  veiling_id TEXT NOT NULL REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'artwork')),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  created_at INTEGER NOT NULL
);
CREATE INDEX catalog_audit_veiling ON catalog_audit(veiling_id, created_at);
CREATE TRIGGER catalog_audit_no_update BEFORE UPDATE ON catalog_audit BEGIN SELECT RAISE(ABORT, 'catalog audit is append-only'); END;
CREATE TRIGGER catalog_audit_no_delete BEFORE DELETE ON catalog_audit BEGIN SELECT RAISE(ABORT, 'catalog audit is append-only'); END;

-- Read-only foundation, pending the separately reviewed physical-card/claim
-- model. There is deliberately no ownership mutation or issuance endpoint.
CREATE TABLE ownerships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  veiling_id TEXT NOT NULL REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  acquisition TEXT NOT NULL CHECK (acquisition = 'server_grant'),
  acquired_at INTEGER NOT NULL
);
CREATE INDEX ownerships_collector ON ownerships(user_id, veiling_id);

-- Discovery is an independent authoritative fact, never inferred from catalog
-- creation or a browser action. No discovery/achievement mutation API exists.
CREATE TABLE discoveries (
  veiling_id TEXT PRIMARY KEY REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('undiscovered', 'revealed')),
  first_discovered_at INTEGER,
  first_discoverer_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  reveal_kind TEXT CHECK (reveal_kind IS NULL OR reveal_kind IN ('launch', 'collector')),
  CHECK (status = 'revealed' OR (first_discovered_at IS NULL AND first_discoverer_id IS NULL AND reveal_kind IS NULL))
);
