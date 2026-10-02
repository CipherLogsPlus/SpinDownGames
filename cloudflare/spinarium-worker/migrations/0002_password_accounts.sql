-- Direct email/password credentials. Emails are account names, not verified
-- contact addresses, authority, or links to identities from another provider.
-- Existing application users, sessions and collector data retain their IDs.
CREATE TABLE password_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL UNIQUE CHECK (length(email_normalized) BETWEEN 3 AND 254),
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(window_start);
