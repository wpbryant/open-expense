"use strict";

// SQLite persistence. One file on disk (everything is a file).
// better-sqlite3 is synchronous — keeps request handlers simple, no await soup.
// Initializes schema + seeds an admin user and default categories on first run.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const config = require("./config");
const { DEFAULT_CATEGORIES } = require("./categories");

function ensureDirFor(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let _db = null;

function open() {
  if (_db) return _db;
  ensureDirFor(config.dbPath);
  _db = new Database(config.dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  seed(_db);
  return _db;
}

// --- Schema -----------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,           -- sha256 of the raw token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,              -- ISO datetime
  used_at    TEXT,                       -- set when consumed (single-use)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id      INTEGER REFERENCES reports(id) ON DELETE SET NULL,
  amount         REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'USD',
  date           TEXT NOT NULL,            -- ISO YYYY-MM-DD
  merchant       TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  receipt_path   TEXT,                     -- relative path under receipts dir
  ocr_confidence TEXT,                     -- 'high'|'medium'|'low'|null
  ocr_raw        TEXT,                     -- raw JSON string from OCR
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft|submitted|approved|rejected
  purpose     TEXT NOT NULL DEFAULT '',        -- free-text business purpose
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_user   ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_report ON expenses(report_id);
CREATE INDEX IF NOT EXISTS idx_reports_user    ON reports(user_id);
`;

function migrate(db) {
  db.exec(SCHEMA);
  // Add columns to pre-existing databases (CREATE TABLE only applies to new ones).
  ensureColumn(db, "users", "first_name", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "last_name", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "email", "TEXT NOT NULL DEFAULT ''");
}

// Add a column only if it doesn't already exist (idempotent ALTER TABLE).
function ensureColumn(db, table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

// --- Seed -------------------------------------------------------------------

function seed(db) {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount === 0) {
    const hash = bcrypt.hashSync(config.seedAdmin.password, 10);
    db.prepare(
      "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)"
    ).run(config.seedAdmin.username, hash);
  }

  const catCount = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (catCount === 0) {
    const ins = db.prepare("INSERT INTO categories (name) VALUES (?)");
    for (const c of DEFAULT_CATEGORIES) ins.run(c);
  }
}

// --- Tiny query helpers -----------------------------------------------------
// Keep raw prepared statements close to callers; these are just conveniences.

const db = {
  get open() {
    return open();
  },
  all(sql, ...params) {
    return this.open.prepare(sql).all(...params);
  },
  get(sql, ...params) {
    return this.open.prepare(sql).get(...params);
  },
  run(sql, ...params) {
    return this.open.prepare(sql).run(...params);
  },
};

module.exports = db;
