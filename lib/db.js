import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * SQLite adapter. All SQL below is deliberately written in portable ANSI-ish
 * form (TEXT uuids, ISO-8601 timestamps, integer minor units) so the same
 * queries can be pointed at Postgres later by swapping this module for a `pg`
 * pool. Nothing outside this file talks to the driver directly.
 */

const DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('personal','organization')),
  owner_id      TEXT NOT NULL REFERENCES users(id),
  currency_code TEXT NOT NULL DEFAULT 'INR',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id),
  invited_email TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  member_scope  TEXT NOT NULL DEFAULT 'all'    CHECK (member_scope IN ('all','own_only')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','removed')),
  invited_by    TEXT REFERENCES users(id),
  joined_at     TEXT,
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_wm_ws ON workspace_members (workspace_id);
CREATE INDEX IF NOT EXISTS idx_wm_email ON workspace_members (invited_email);

CREATE TABLE IF NOT EXISTS categories (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  parent_id    TEXT REFERENCES categories(id),
  color        TEXT NOT NULL,
  is_default   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cat_ws ON categories (workspace_id);

CREATE TABLE IF NOT EXISTS transactions (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by       TEXT NOT NULL REFERENCES users(id),
  type             TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount_minor     INTEGER NOT NULL,
  currency_code    TEXT NOT NULL,
  category_id      TEXT REFERENCES categories(id),
  merchant         TEXT,
  notes            TEXT,
  tags             TEXT,
  transaction_date TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  is_deleted       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_txn_ws_date ON transactions (workspace_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_txn_ws_by ON transactions (workspace_id, created_by);

CREATE TABLE IF NOT EXISTS budgets (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category_id        TEXT REFERENCES categories(id),
  period             TEXT NOT NULL CHECK (period IN ('weekly','monthly')),
  limit_amount_minor INTEGER NOT NULL,
  start_date         TEXT NOT NULL,
  rollover           INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_ws ON budgets (workspace_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id     TEXT NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  diff         TEXT,
  summary      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ws ON audit_log (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS agent_query_log (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id),
  query_text       TEXT NOT NULL,
  resolved_scope   TEXT NOT NULL,
  response_summary TEXT,
  tool_calls       TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aql_ws ON agent_query_log (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS agent_messages (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  role         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_am_ws ON agent_messages (workspace_id, user_id, created_at);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rt_hash ON refresh_tokens (token_hash);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        TEXT,
  PRIMARY KEY (user_id, workspace_id, key)
);
`;

const g = globalThis;

function open() {
  const file = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(DDL);
  return db;
}

export function getDb() {
  if (!g.__ledgerDb) {
    g.__ledgerDb = open();
  }
  return g.__ledgerDb;
}

export const all = (sql, params = []) => getDb().prepare(sql).all(params);
export const one = (sql, params = []) => getDb().prepare(sql).get(params) || null;
export const run = (sql, params = []) => getDb().prepare(sql).run(params);
export const tx = (fn) => getDb().transaction(fn)();
