-- Safe account administration and indexed directory reads. Role/email directory
-- columns are maintained by database triggers; authorization always uses the
-- current allowlist/session, never these query accelerators.
ALTER TABLE users ADD COLUMN account_revision INTEGER NOT NULL DEFAULT 1 CHECK (account_revision >= 1);
ALTER TABLE users ADD COLUMN last_login_at INTEGER CHECK (last_login_at IS NULL OR last_login_at >= 0);
ALTER TABLE users ADD COLUMN display_name_search TEXT GENERATED ALWAYS AS (lower(display_name)) VIRTUAL;
ALTER TABLE users ADD COLUMN account_email TEXT;
ALTER TABLE users ADD COLUMN account_role TEXT NOT NULL DEFAULT 'collector' CHECK (account_role IN ('collector', 'admin', 'owner'));
ALTER TABLE admin_allowlist ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'owner'));
CREATE UNIQUE INDEX admin_allowlist_single_owner ON admin_allowlist(role) WHERE role = 'owner';
UPDATE users SET account_email = (SELECT email_normalized FROM password_accounts WHERE user_id = users.id);
UPDATE users SET account_role = (SELECT role FROM admin_allowlist WHERE user_id = users.id) WHERE EXISTS (SELECT 1 FROM admin_allowlist WHERE user_id = users.id);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX password_resets_expiry ON password_resets(expires_at);

-- UUID provenance intentionally survives trusted account deletion. There is no
-- public deletion API. Before/after data never includes credentials or tokens.
CREATE TABLE account_audit (
  id TEXT PRIMARY KEY,
  target_user_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('profile_updated', 'account_disabled', 'account_enabled', 'sessions_revoked', 'role_changed', 'password_reset_issued', 'password_reset_completed')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  created_at INTEGER NOT NULL
);
CREATE INDEX account_audit_target ON account_audit(target_user_id, created_at DESC, id DESC);
CREATE TRIGGER account_audit_no_update BEFORE UPDATE ON account_audit BEGIN SELECT RAISE(ABORT, 'account audit is append-only'); END;
CREATE TRIGGER account_audit_no_delete BEFORE DELETE ON account_audit BEGIN SELECT RAISE(ABORT, 'account audit is append-only'); END;

CREATE TRIGGER account_directory_password_insert AFTER INSERT ON password_accounts BEGIN UPDATE users SET account_email = NEW.email_normalized WHERE id = NEW.user_id; END;
CREATE TRIGGER account_directory_password_update AFTER UPDATE OF email_normalized ON password_accounts BEGIN UPDATE users SET account_email = NEW.email_normalized WHERE id = NEW.user_id; END;
CREATE TRIGGER account_directory_password_delete AFTER DELETE ON password_accounts BEGIN UPDATE users SET account_email = NULL WHERE id = OLD.user_id; END;
CREATE TRIGGER account_directory_admin_insert AFTER INSERT ON admin_allowlist BEGIN UPDATE users SET account_role = NEW.role, account_revision = account_revision + 1, updated_at = unixepoch() WHERE id = NEW.user_id; DELETE FROM password_resets WHERE user_id = NEW.user_id; END;
CREATE TRIGGER account_directory_admin_delete AFTER DELETE ON admin_allowlist BEGIN UPDATE users SET account_role = 'collector', account_revision = account_revision + 1, updated_at = unixepoch() WHERE id = OLD.user_id; DELETE FROM password_resets WHERE user_id = OLD.user_id OR created_by = OLD.user_id; END;
CREATE TRIGGER account_directory_admin_update AFTER UPDATE OF role, user_id ON admin_allowlist BEGIN UPDATE users SET account_role = 'collector', account_revision = account_revision + 1, updated_at = unixepoch() WHERE id = OLD.user_id AND OLD.user_id != NEW.user_id; UPDATE users SET account_role = NEW.role, account_revision = account_revision + 1, updated_at = unixepoch() WHERE id = NEW.user_id; DELETE FROM password_resets WHERE user_id IN (OLD.user_id, NEW.user_id) OR created_by = OLD.user_id; END;

CREATE INDEX users_account_newest ON users(created_at DESC, id DESC);
CREATE INDEX users_account_status_newest ON users(disabled, created_at DESC, id DESC);
CREATE INDEX users_account_role_newest ON users(account_role, created_at DESC, id DESC);
CREATE INDEX users_account_status_role_newest ON users(disabled, account_role, created_at DESC, id DESC);
CREATE INDEX users_account_email ON users(account_email, id);
CREATE INDEX users_account_status_email ON users(disabled, account_email, id);
CREATE INDEX users_account_role_email ON users(account_role, account_email, id);
CREATE INDEX users_account_status_role_email ON users(disabled, account_role, account_email, id);
CREATE INDEX users_account_name ON users(display_name_search, id);
CREATE INDEX users_account_status_name ON users(disabled, display_name_search, id);
CREATE INDEX users_account_role_name ON users(account_role, display_name_search, id);
CREATE INDEX users_account_status_role_name ON users(disabled, account_role, display_name_search, id);
CREATE INDEX sessions_account_active ON sessions(user_id, expires_at);
CREATE INDEX ownerships_account_newest ON ownerships(user_id, acquired_at DESC, id DESC);
