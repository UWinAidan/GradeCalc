-- Accounts (Round 5). No passwords: identity = sign-in provider + that provider's subject id.
-- One gradebook row per user (the whole gradebook as JSON, versioned for optimistic concurrency).
-- Apply: npx wrangler d1 migrations apply gradecalc --remote

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject TEXT NOT NULL,            -- Google: sub. Microsoft: "<tid>:<oid>". Never an email: accounts are never linked by email.
  email TEXT,                       -- a label for the Account page only; never used to find, link or authorise an account
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  consent_version INTEGER,          -- consent text version accepted (NULL = not yet: no cloud writes)
  consent_at TEXT,
  UNIQUE (provider, subject)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,      -- SHA-256 (hex) of the cookie token; the token itself is never stored
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,               -- sent back in X-CSRF-Token on every write
  created_at INTEGER NOT NULL,      -- unix seconds
  expires_at INTEGER NOT NULL       -- unix seconds, checked on every request
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE gradebooks (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  doc TEXT NOT NULL,                -- the gradebook document (same shape as guest mode's localStorage document)
  version INTEGER NOT NULL,         -- +1 on every save; a save must name the version it was based on (else 409)
  bytes INTEGER NOT NULL,           -- size of doc, for the admin page's storage total
  updated_at TEXT NOT NULL
);
