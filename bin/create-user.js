#!/usr/bin/env node
"use strict";

// create-user <username> [--password p] [--admin]
//   Creates (or resets) a login account. If the user exists, password/admin
//   flag are updated. Password is prompted for if not given via --password.
//
//   node bin/create-user.js alice --admin
//   node bin/create-user.js bob --password hunter2

const db = require("../src/lib/db");
const { hashPassword } = require("../src/lib/auth");
const readline = require("readline");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function promptPassword() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Password: ", (p) => {
      rl.close();
      resolve(p);
    });
  });
}

async function main() {
  const pos = process.argv.filter(
    (a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]
  );
  const username = pos[0];
  if (!username) {
    process.stderr.write("usage: create-user <username> [--password p] [--admin]\n");
    process.exit(2);
  }
  const admin = process.argv.includes("--admin");
  let password = arg("--password");
  if (!password) password = await promptPassword();
  if (!password) {
    process.stderr.write("error: empty password\n");
    process.exit(1);
  }

  const existing = db.get("SELECT id FROM users WHERE username = ?", username);
  const hash = hashPassword(password);
  if (existing) {
    db.run("UPDATE users SET password_hash = ?, is_admin = ? WHERE id = ?", hash, admin ? 1 : 0, existing.id);
    process.stdout.write(`updated user '${username}' (admin=${admin ? 1 : 0})\n`);
  } else {
    db.run("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)", username, hash, admin ? 1 : 0);
    process.stdout.write(`created user '${username}' (admin=${admin ? 1 : 0})\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`error: ${e.message || e}\n`);
  process.exit(1);
});
