-- Ashenling digital pilot. Physical cards remain independent; no codes are seeded.
-- Never store the printable redemption code: only its SHA-256 hash.
CREATE TABLE digital_claims (
  id TEXT PRIMARY KEY,
  veiling_id TEXT NOT NULL REFERENCES catalog_veilings(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  issued_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at),
  redeemed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  redeemed_at INTEGER,
  ownership_id TEXT UNIQUE REFERENCES ownerships(id) ON DELETE RESTRICT,
  revoked_at INTEGER,
  CHECK ((redeemed_by IS NULL AND redeemed_at IS NULL AND ownership_id IS NULL) OR
         (redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL AND ownership_id IS NOT NULL)),
  CHECK (revoked_at IS NULL OR redeemed_at IS NULL)
);
CREATE INDEX digital_claims_issued ON digital_claims(veiling_id, issued_at);
CREATE INDEX digital_claims_redemptions ON digital_claims(redeemed_by, redeemed_at);
