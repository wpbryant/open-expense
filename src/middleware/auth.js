"use strict";

// Auth guards. Session-based: req.session.userId is set on login.

function currentUserId(req) {
  return req.session && req.session.userId;
}

// Attach the current user (id, username, isAdmin) to res.locals for every view.
function loadUser(db) {
  return (req, res, next) => {
    const id = currentUserId(req);
    if (id) {
      const u = db.get("SELECT id, username, is_admin FROM users WHERE id = ?", id);
      res.locals.currentUser = u || null;
      req.user = u || null;
    } else {
      res.locals.currentUser = null;
      req.user = null;
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (currentUserId(req)) return next();
  if (req.accepts("html")) {
    req.session = req.session || {};
    req.session.returnTo = req.originalUrl || req.url;
    return res.redirect("/login");
  }
  return res.status(401).json({ error: "Authentication required" });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  if (req.accepts("html")) {
    return res.status(403).send("Forbidden — administrators only.");
  }
  return res.status(403).json({ error: "Admin only" });
}

module.exports = { loadUser, requireAuth, requireAdmin, currentUserId };
