"use strict";

// Default expense categories. Stored in the DB so the admin panel can manage
// them, but seeded from this list on first run.

const DEFAULT_CATEGORIES = [
  "Meals",
  "Travel",
  "Lodging",
  "Transportation",
  "Parking & Tolls",
  "Office Supplies",
  "Software & Subscriptions",
  "Hardware & Equipment",
  "Utilities",
  "Telecom",
  "Client Entertainment",
  "Training & Education",
  "Conferences & Events",
  "Advertising & Marketing",
  "Professional Fees",
  "Mileage",
  "Miscellaneous",
];

module.exports = { DEFAULT_CATEGORIES };
