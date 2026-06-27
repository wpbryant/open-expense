"use strict";

// Password helpers. Pure functions over bcrypt — no Express here.

const bcrypt = require("bcrypt");

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
