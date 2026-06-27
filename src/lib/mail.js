"use strict";

// Outbound email (password-reset links). Uses nodemailer over SMTP when
// configured; if not, senders must handle the "not configured" case themselves
// (e.g. show the link to the admin to copy).

const nodemailer = require("nodemailer");
const config = require("./config");

function isConfigured() {
  return Boolean(config.smtp && config.smtp.host);
}

let _transport = null;
function transport() {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return _transport;
}

// Send a plain-text email. Throws if SMTP isn't configured.
async function send({ to, subject, text }) {
  if (!isConfigured()) {
    throw new Error("SMTP is not configured (SMTP_HOST).");
  }
  const info = await transport().sendMail({
    from: config.mailFrom,
    to,
    subject,
    text,
  });
  return info;
}

module.exports = { send, isConfigured };
