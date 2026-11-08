import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS one_time_codes (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    email TEXT,
    user_id TEXT REFERENCES users(id),
    session_hash TEXT,
    subject TEXT,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    verified_at INTEGER,
    consumed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS agent_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
    current_consent_id TEXT,
    connected_at TEXT NOT NULL,
    revoked_at TEXT,
    last_activity_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_connection_per_agent
    ON agent_connections (user_id, agent_id) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS consents (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES agent_connections(id),
    version INTEGER NOT NULL,
    mandate_json TEXT NOT NULL,
    signature TEXT NOT NULL,
    key_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    superseded_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL UNIQUE REFERENCES agent_connections(id),
    token_hash TEXT NOT NULL UNIQUE,
    last4 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );

  -- What the mock agent holds. The guard only ever compares against tokens.token_hash.
  CREATE TABLE IF NOT EXISTS mock_agent_credentials (
    connection_id TEXT PRIMARY KEY REFERENCES agent_connections(id),
    token TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id),
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    message TEXT NOT NULL,
    purchase_id TEXT,
    flagged INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS wallet_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
