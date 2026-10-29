-- Private Ashenling claim pilot. The codes are unrelated to catalog number 001.
-- Store ONLY SHA-256 token hashes; never store the printable/QR claim secret.
-- Records remain after redemption, expiry, or revocation; no silent reuse.
CREATE TABLE digital_claims (
  id TEXT PRIMARY KEY,
  veiling_id TEXT NOT NULL REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  issued_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at),
  redeemed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  redeemed_at INTEGER,
  ownership_id TEXT UNIQUE,
  revoked_at INTEGER,
  CHECK (
    (redeemed_by IS NULL AND redeemed_at IS NULL AND ownership_id IS NULL)
    OR (redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL AND ownership_id IS NOT NULL)
  ),
  CHECK (revoked_at IS NULL OR redeemed_at IS NULL)
);
CREATE INDEX digital_claims_issuer ON digital_claims(issued_by, issued_at);
CREATE INDEX digital_claims_veiling ON digital_claims(veiling_id, issued_at);

-- A claimed or revoked code can never be reset by a future application update.
CREATE TRIGGER digital_claims_no_delete BEFORE DELETE ON digital_claims
BEGIN SELECT RAISE(ABORT, 'digital claim history is permanent'); END;
CREATE TRIGGER digital_claims_immutable_fields BEFORE UPDATE ON digital_claims
WHEN NEW.id != OLD.id OR NEW.veiling_id != OLD.veiling_id
  OR NEW.token_hash != OLD.token_hash OR NEW.issued_by != OLD.issued_by
  OR NEW.issued_at != OLD.issued_at OR NEW.expires_at != OLD.expires_at
  OR OLD.redeemed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'digital claim cannot be reused or rewritten'); END;
