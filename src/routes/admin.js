"use strict";

// Admin panel: global stats, user management, category management.
// Mounted under /admin with requireAuth + requireAdmin.

const express = require("express");
const db = require("../lib/db");
const { hashPassword } = require("../lib/auth");
const { requireAdmin } = require("../middleware/auth");
const queries = require("../lib/queries");
const passwords = require("../lib/passwords");
const mail = require("../lib/mail");

const router = express.Router();

router.use(requireAdmin);

router.get("/", (req, res) => {
  res.render("admin/index", { stats: queries.adminStats() });
});

// --- Users ------------------------------------------------------------------

router.get("/users", (req, res) => {
  res.render("admin/users", {
    users: db.all("SELECT id, username, first_name, last_name, email, is_admin, created_at FROM users ORDER BY id"),
    mailConfigured: mail.isConfigured(),
  });
});

router.post("/users", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const isAdmin = req.body.is_admin === "on" || req.body.is_admin === "1";
  const first_name = String(req.body.first_name || "").trim();
  const last_name = String(req.body.last_name || "").trim();
  const email = String(req.body.email || "").trim();
  if (!username || !password) {
    req.flash("error", "Username and password are required.");
    return res.redirect("/admin/users");
  }
  const existing = db.get("SELECT id FROM users WHERE username = ?", username);
  if (existing) {
    req.flash("error", `Username '${username}' already exists.`);
    return res.redirect("/admin/users");
  }
  db.run(
    "INSERT INTO users (username, password_hash, first_name, last_name, email, is_admin) VALUES (?, ?, ?, ?, ?, ?)",
    username, hashPassword(password), first_name, last_name, email, isAdmin ? 1 : 0
  );
  req.flash("success", `User '${username}' created.`);
  res.redirect("/admin/users");
});

router.post("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const isAdmin = req.body.is_admin === "on" || req.body.is_admin === "1";
  const password = String(req.body.password || "");
  const first_name = String(req.body.first_name || "").trim();
  const last_name = String(req.body.last_name || "").trim();
  const email = String(req.body.email || "").trim();
  const target = db.get("SELECT * FROM users WHERE id = ?", id);
  if (!target) {
    req.flash("error", "User not found.");
    return res.redirect("/admin/users");
  }
  if (password) {
    db.run(
      "UPDATE users SET password_hash=?, first_name=?, last_name=?, email=?, is_admin=? WHERE id=?",
      hashPassword(password), first_name, last_name, email, isAdmin ? 1 : 0, id
    );
    req.flash("success", `Updated '${target.username}' (password reset).`);
  } else {
    db.run(
      "UPDATE users SET first_name=?, last_name=?, email=?, is_admin=? WHERE id=?",
      first_name, last_name, email, isAdmin ? 1 : 0, id
    );
    req.flash("success", `Updated '${target.username}'.`);
  }
  res.redirect("/admin/users");
});

// Admin sends a password-reset link to a user's email.
router.post("/users/:id/send-reset", async (req, res, next) => {
  const id = Number(req.params.id);
  const target = db.get("SELECT id, username, first_name, last_name, email FROM users WHERE id = ?", id);
  if (!target) {
    req.flash("error", "User not found.");
    return res.redirect("/admin/users");
  }
  const token = passwords.createToken(target.id);
  const link = passwords.resetLink(token);
  const name = [target.first_name, target.last_name].filter(Boolean).join(" ") || target.username;

  if (!target.email || !mail.isConfigured()) {
    // Can't email it — give the admin the link to deliver themselves.
    req.flash(
      "info",
      `Reset link for ${target.username} (email ${
        target.email ? "set but SMTP not configured" : "not set"
      }): ${link}`
    );
    return res.redirect("/admin/users");
  }

  try {
    await mail.send({
      to: target.email,
      subject: "Reset your OpenExpense password",
      text: [
        `Hi ${name},`,
        "",
        "An administrator generated a password-reset link for your OpenExpense account.",
        `Username: ${target.username}`,
        "",
        "Reset your password (link expires in 24 hours):",
        link,
        "",
        "If you didn't expect this, you can ignore this email.",
      ].join("\n"),
    });
    req.flash("success", `Reset link sent to ${target.email}.`);
  } catch (e) {
    req.flash("error", `Could not send email: ${e.message}. Link: ${link}`);
  }
  res.redirect("/admin/users");
});

router.post("/users/:id/delete", (req, res) => {
  const id = Number(req.params.id);
  if (id === res.locals.currentUser.id) {
    req.flash("error", "You cannot delete your own account.");
    return res.redirect("/admin/users");
  }
  const count = db.get("SELECT COUNT(*) AS n FROM users").n;
  if (count <= 1) {
    req.flash("error", "Cannot delete the last user.");
    return res.redirect("/admin/users");
  }
  db.run("DELETE FROM users WHERE id=?", id);
  req.flash("success", "User deleted.");
  res.redirect("/admin/users");
});

// --- Categories -------------------------------------------------------------

router.get("/categories", (req, res) => {
  res.render("admin/categories", {
    categories: db.all("SELECT * FROM categories ORDER BY name"),
    inUse: usageMap(),
  });
});

router.post("/categories", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) {
    req.flash("error", "Category name is required.");
    return res.redirect("/admin/categories");
  }
  try {
    db.run("INSERT INTO categories (name) VALUES (?)", name);
    req.flash("success", `Category '${name}' added.`);
  } catch {
    req.flash("error", `Category '${name}' already exists.`);
  }
  res.redirect("/admin/categories");
});

router.post("/categories/:id/delete", (req, res) => {
  db.run("DELETE FROM categories WHERE id=?", Number(req.params.id));
  req.flash("success", "Category deleted. Existing expenses keep their value.");
  res.redirect("/admin/categories");
});

function usageMap() {
  const rows = db.all(
    "SELECT category, COUNT(*) AS n FROM expenses GROUP BY category"
  );
  const m = {};
  for (const r of rows) m[(r.category || "").toLowerCase()] = r.n;
  return m;
}

module.exports = router;
