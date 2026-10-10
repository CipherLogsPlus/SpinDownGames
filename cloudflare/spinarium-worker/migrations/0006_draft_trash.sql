-- Reversible draft trash. Existing catalog rows, immutable history and artwork
-- stay in place; no DELETE, object cleanup or ownership mutation is performed.
ALTER TABLE catalog_veilings ADD COLUMN trashed_at INTEGER CHECK (trashed_at IS NULL OR trashed_at >= 0);
ALTER TABLE catalog_veilings ADD COLUMN trashed_by TEXT REFERENCES users(id) ON DELETE RESTRICT
  CHECK ((trashed_at IS NULL AND trashed_by IS NULL) OR (trashed_at IS NOT NULL AND trashed_by IS NOT NULL));
CREATE INDEX catalog_veilings_trash ON catalog_veilings(trashed_at, character_number, created_at);

CREATE TABLE draft_trash_audit (
  id TEXT PRIMARY KEY,
  veiling_id TEXT NOT NULL REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('trash', 'restore')),
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  created_at INTEGER NOT NULL
);
CREATE INDEX draft_trash_audit_veiling ON draft_trash_audit(veiling_id, created_at, id);
CREATE TRIGGER draft_trash_audit_no_update BEFORE UPDATE ON draft_trash_audit BEGIN SELECT RAISE(ABORT, 'draft trash audit is append-only'); END;
CREATE TRIGGER draft_trash_audit_no_delete BEFORE DELETE ON draft_trash_audit BEGIN SELECT RAISE(ABORT, 'draft trash audit is append-only'); END;

-- Protect the invariant even from older Worker versions and trusted SQL tools.
-- A formerly published/legacy-visible row is not an unpublished draft, even
-- after its current publication is hidden or its status is changed to draft.
CREATE TRIGGER catalog_trash_eligibility BEFORE UPDATE OF trashed_at ON catalog_veilings
WHEN OLD.trashed_at IS NULL AND NEW.trashed_at IS NOT NULL AND (
  NEW.status != 'draft' OR EXISTS(SELECT 1 FROM veiling_publications WHERE veiling_id=OLD.id)
  OR EXISTS(SELECT 1 FROM publication_audit WHERE veiling_id=OLD.id)
  OR EXISTS(SELECT 1 FROM catalog_audit WHERE veiling_id=OLD.id AND (json_extract(after_json,'$.status') IN ('active','retired') OR json_extract(before_json,'$.status') IN ('active','retired')))
  OR EXISTS(SELECT 1 FROM ownerships WHERE veiling_id=OLD.id)
  OR EXISTS(SELECT 1 FROM discoveries WHERE veiling_id=OLD.id)
) BEGIN SELECT RAISE(ABORT, 'only unpublished unowned drafts can be trashed'); END;
CREATE TRIGGER catalog_trashed_content_no_update BEFORE UPDATE ON catalog_veilings
WHEN OLD.trashed_at IS NOT NULL AND (
  NEW.name IS NOT OLD.name OR NEW.description IS NOT OLD.description OR NEW.character_number IS NOT OLD.character_number
  OR NEW.status IS NOT OLD.status OR NEW.rarity IS NOT OLD.rarity OR NEW.edition IS NOT OLD.edition OR NEW.artwork_id IS NOT OLD.artwork_id
) BEGIN SELECT RAISE(ABORT, 'restore the draft before editing'); END;
CREATE TRIGGER artwork_no_trashed_draft BEFORE INSERT ON artwork
WHEN EXISTS(SELECT 1 FROM catalog_veilings WHERE id=NEW.veiling_id AND trashed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'restore the draft before uploading artwork'); END;
CREATE TRIGGER publication_no_trashed_draft BEFORE INSERT ON veiling_publications
WHEN EXISTS(SELECT 1 FROM catalog_veilings WHERE id=NEW.veiling_id AND trashed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'restore the draft before publication'); END;
CREATE TRIGGER publication_update_no_trashed_draft BEFORE UPDATE ON veiling_publications
WHEN EXISTS(SELECT 1 FROM catalog_veilings WHERE id=NEW.veiling_id AND trashed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'restore the draft before publication'); END;
CREATE TRIGGER ownership_no_trashed_draft BEFORE INSERT ON ownerships
WHEN EXISTS(SELECT 1 FROM catalog_veilings WHERE id=NEW.veiling_id AND trashed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'restore the draft before granting ownership'); END;
CREATE TRIGGER ownership_update_no_trashed_draft BEFORE UPDATE ON ownerships
WHEN EXISTS(SELECT 1 FROM catalog_veilings WHERE id=NEW.veiling_id AND trashed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'restore the draft before granting ownership'); END;
CREATE TRIGGER discovery_no_trashed_draft BEFORE INSERT ON discoveries
WHEN EXISTS(SELECT 1 FROM catalog_veilings WHERE id=NEW.veiling_id AND trashed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'restore the draft before recording discovery'); END;
CREATE TRIGGER discovery_update_no_trashed_draft BEFORE UPDATE ON discoveries
WHEN EXISTS(SELECT 1 FROM catalog_veilings WHERE id=NEW.veiling_id AND trashed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'restore the draft before recording discovery'); END;
