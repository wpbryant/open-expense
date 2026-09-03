"use strict";

// Org-wide settings — the app's first key/value store (admin-editable at
// /admin/settings). Cached per process; the cache is invalidated on write so an
// admin edit applies to the next request. Reads fall back to seeded defaults so
// a missing or garbage value can never break expense entry.

const db = require("./db");
const maps = require("./maps");

const DEFAULTS = { mileage_rate: "0.76", mileage_unit: "mi" };
const METERS_PER_UNIT = { mi: 1609.344, km: 1000 };

const cache = new Map();

function get(key, fallback = "") {
  if (cache.has(key)) return cache.get(key);
  const row = db.get("SELECT value FROM settings WHERE key = ?", key);
  const value = row && row.value !== "" ? row.value : (DEFAULTS[key] !== undefined ? DEFAULTS[key] : fallback);
  cache.set(key, value);
  return value;
}

function set(key, value) {
  db.run(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    key, String(value)
  );
  cache.delete(key);
}

// Effective mileage configuration. Computed per request and passed into views —
// never parked in app.locals, which is a boot-time snapshot that would go stale
// after an admin edit.
function mileage() {
  let rate = Number(get("mileage_rate"));
  if (!Number.isFinite(rate) || rate <= 0) rate = Number(DEFAULTS.mileage_rate);
  let unit = String(get("mileage_unit")).trim().toLowerCase();
  if (unit !== "mi" && unit !== "km") unit = DEFAULTS.mileage_unit;
  return { rate, unit, autoDistance: maps.isConfigured() };
}

// Meters -> mi/km (full precision; callers decide on rounding).
function fromMeters(meters, unit) {
  const per = METERS_PER_UNIT[unit] || METERS_PER_UNIT.mi;
  return (Number(meters) || 0) / per;
}

// Single source of truth for gating the mileage UI/logic on the category text
// (categories are free text, so there is no id to key off).
function isMileage(category) {
  return String(category || "").trim().toLowerCase() === "mileage";
}

module.exports = { get, set, mileage, fromMeters, isMileage };
