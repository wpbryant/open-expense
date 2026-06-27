"use strict";

// Password-reset tokens. Tokens are random bytes carried in the link; only the
// sha256 hash is stored, so a DB leak doesn't expose valid tokens. Tokens are
// single-use and expire.

const crypto = require("crypto");
const db = require("./db");
const config = require("./config");

const TTL_HOURS = 24;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function expiryString() {
  // datetime('now', '+24 hours') style, computed server-side for consistency
  const d = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

// Create a new reset token for a user; returns the raw token (for the link).
function createToken(userId) {
  // invalidate any previous unused tokens for this user first
  db.run("UPDATE password_resets SET used_at=datetime('now') WHERE user_id=? AND used_at IS NULL", userId);
  const token = crypto.randomBytes(32).toString("hex");
  db.run(
    "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    hashToken(token),
    userId,
    expiryString()
  );
  return token;
}

// Look up a valid (unused, unexpired) token → user row, or null.
function validate(token) {
  if (!token) return null;
  const row = db.get(
    `SELECT r.user_id AS uid, r.used_at, r.expires_at,
            datetime('now') AS now
       FROM password_resets r WHERE r.token_hash=?`,
    hashToken(token)
  );
  if (!row) return null;
  if (row.used_at) return null;
  if (row.expires_at < row.now) return null;
  return db.get("SELECT id, username, first_name, last_name, email FROM users WHERE id=?", row.uid);
}

// Consume a token (mark used) — call only after a successful password change.
function consume(token) {
  db.run("UPDATE password_resets SET used_at=datetime('now') WHERE token_hash=?", hashToken(token));
}

function resetLink(token) {
  return `${config.baseUrl}/reset-password?token=${token}`;
}

module.exports = { createToken, validate, consume, resetLink, TTL_HOURS };
