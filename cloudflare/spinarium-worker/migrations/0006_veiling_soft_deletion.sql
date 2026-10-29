-- Soft-delete catalog Veilings without breaking ownerships, prior artwork or append-only history.
-- Deleting never revokes collector ownership and never purges private R2 artwork.
ALTER TABLE catalog_veilings ADD COLUMN deleted_at INTEGER;
ALTER TABLE catalog_veilings ADD COLUMN deleted_by TEXT REFERENCES users(id);
CREATE INDEX catalog_veilings_active ON catalog_veilings(deleted_at, created_at);
CREATE TABLE veiling_deletion_audit (
  id TEXT PRIMARY KEY,
  veiling_id TEXT NOT NULL REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  created_at INTEGER NOT NULL
);
CREATE INDEX veiling_deletion_audit_record ON veiling_deletion_audit(veiling_id, created_at);
CREATE TRIGGER veiling_deletion_audit_no_update BEFORE UPDATE ON veiling_deletion_audit BEGIN SELECT RAISE(ABORT, 'deletion audit is append-only'); END;
CREATE TRIGGER veiling_deletion_audit_no_delete BEFORE DELETE ON veiling_deletion_audit BEGIN SELECT RAISE(ABORT, 'deletion audit is append-only'); END;
