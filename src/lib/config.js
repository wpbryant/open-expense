"use strict";

// Central configuration. Reads env (with .env via dotenv at process entry).
// One small module that owns all paths/settings so the rest of the app
// never reaches into process.env directly.

const path = require("path");

// Load .env if present. config is the first thing every entry point imports,
// so doing it here guarantees env vars exist for the rest of the app.
try {
  require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });
} catch {
  /* dotenv optional in some installs; ignore */
}

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const config = {
  root: PROJECT_ROOT,
  port: parseInt(process.env.PORT || "3000", 10),
  env: process.env.NODE_ENV || "development",
  isProd: (process.env.NODE_ENV || "") === "production",

  sessionSecret: process.env.SESSION_SECRET || "dev-insecure-secret-change-me",

  // Gemini / OCR
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  ocrEnabled: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),

  // Storage paths (resolved relative to project root)
  dbPath: path.resolve(PROJECT_ROOT, process.env.DB_PATH || "data/app.db"),
  receiptsDir: path.resolve(PROJECT_ROOT, process.env.RECEIPTS_DIR || "data/receipts"),

  // Outward-facing base URL (used to build password-reset links).
  baseUrl: (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, ""),

  // Email (SMTP) for password-reset links. Optional — if unset, the reset link
  // is shown to the admin to copy instead of being emailed.
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: (process.env.SMTP_SECURE || "") === "true",
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || "",
      }
    : null,
  mailFrom: process.env.SMTP_FROM || "OpenExpense <no-reply@localhost>",

  // Seed admin (only used when no users exist)
  seedAdmin: {
    username: process.env.SEED_ADMIN_USERNAME || "admin",
    password: process.env.SEED_ADMIN_PASSWORD || "admin123",
  },
};

module.exports = config;
