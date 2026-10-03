-- SpaceWork: esquema inicial (ver docs/superpowers/specs/2026-10-03-spacework-design.md, secção 3)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleting')),
  quota_bytes INTEGER NOT NULL,
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE login_failures (
  email TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);
CREATE INDEX login_failures_email ON login_failures (email, failed_at);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  parent_id TEXT REFERENCES folders (id),
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX folders_unique_name ON folders (user_id, COALESCE(parent_id, ''), name);
CREATE INDEX folders_parent ON folders (user_id, parent_id);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  folder_id TEXT REFERENCES folders (id),
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  mime TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX files_unique_name ON files (user_id, COALESCE(folder_id, ''), name) WHERE deleted_at IS NULL;
CREATE INDEX files_folder ON files (user_id, folder_id);
CREATE INDEX files_trash ON files (user_id, deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  file_id TEXT NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX shares_file ON shares (file_id);
