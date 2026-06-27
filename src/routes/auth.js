"use strict";

// Auth: login / logout. Plain username + password, session-based.

const express = require("express");
const db = require("../lib/db");
const { verifyPassword, hashPassword } = require("../lib/auth");
const passwords = require("../lib/passwords");

const router = express.Router();

router.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("login", { error: null, username: "" });
});

router.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.get("SELECT * FROM users WHERE username = ?", username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).render("login", {
      error: "Invalid username or password.",
      username,
    });
  }
  req.session.userId = user.id;
  const returnTo = req.session.returnTo || "/";
  delete req.session.returnTo;
  res.redirect(returnTo);
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});
router.get("/logout", (req, res) => res.redirect("/login"));

// --- Password reset (reached only via an admin-generated link) ---------------

router.get("/reset-password", (req, res) => {
  const user = passwords.validate(req.query.token);
  if (!user) {
    return res.render("reset-password", { invalid: true, done: false, token: "" });
  }
  res.render("reset-password", { invalid: false, done: false, token: req.query.token, user });
});

router.post("/reset-password", (req, res) => {
  const token = String(req.body.token || "");
  const password = String(req.body.password || "");
  const confirm = String(req.body.confirm || "");
  const user = passwords.validate(token);

  if (!user) {
    return res.render("reset-password", { invalid: true, done: false, token: "" });
  }
  if (password.length < 6) {
    return res.render("reset-password", {
      invalid: false,
      done: false,
      token,
      user,
      error: "Password must be at least 6 characters.",
    });
  }
  if (password !== confirm) {
    return res.render("reset-password", {
      invalid: false,
      done: false,
      token,
      user,
      error: "Passwords don't match.",
    });
  }

  db.run("UPDATE users SET password_hash=? WHERE id=?", hashPassword(password), user.id);
  passwords.consume(token);
  res.render("reset-password", { invalid: false, done: true, token: "", user });
});

module.exports = router;
