"use strict";

// Minimal flash-messages helper (one-shot notices across redirects).
// Snapshots queued messages at request start so they survive a redirect,
// and also makes same-request renders see anything queued this turn.

module.exports = function flash(req, res, next) {
  if (!req.session) return next();

  const snapshot = req.session.flash || {};
  req.session.flash = {}; // consumed on next render

  const bag = {};
  for (const k of Object.keys(snapshot)) bag[k] = snapshot[k];
  res.locals.messages = bag;

  req.flash = (type, msg) => {
    bag[type] = bag[type] || [];
    bag[type].push(msg);
    // persist so it survives a redirect (shown on the following request)
    req.session.flash[type] = req.session.flash[type] || [];
    req.session.flash[type].push(msg);
  };

  next();
};
