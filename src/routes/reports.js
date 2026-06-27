"use strict";

// Expense reports: group expenses, view totals, export to PDF.

const express = require("express");
const db = require("../lib/db");
const queries = require("../lib/queries");
const { generateReportPdf } = require("../lib/pdf");

const router = express.Router();

const STATUSES = ["draft", "submitted", "approved", "rejected"];

router.get("/", (req, res) => {
  res.render("reports/index", {
    reports: queries.reportsWithTotals(res.locals.currentUser.id),
  });
});

router.get("/new", (req, res) => {
  res.render("reports/form", {
    title: "New report",
    isNew: true,
    report: { name: "", description: "", purpose: "", status: "draft" },
    statuses: STATUSES,
  });
});

router.post("/", (req, res) => {
  const userId = res.locals.currentUser.id;
  const name = String(req.body.name || "").trim();
  if (!name) {
    req.flash("error", "Report name is required.");
    return res.redirect("/reports/new");
  }
  const status = STATUSES.includes(req.body.status) ? req.body.status : "draft";
  const info = db.run(
    "INSERT INTO reports (user_id, name, description, purpose, status) VALUES (?, ?, ?, ?, ?)",
    userId, name, String(req.body.description || "").trim(), String(req.body.purpose || "").trim(), status
  );
  req.flash("success", "Report created.");
  res.redirect("/reports/" + info.lastInsertRowid);
});

router.get("/:id", (req, res) => {
  const userId = res.locals.currentUser.id;
  const report = queries.getReport(userId, req.params.id);
  if (!report) return res.status(404).render("error", { message: "Report not found." });
  const expenses = queries.reportExpenses(report.id, userId);
  // expenses that can be attached: this user's, not already in a report
  const attachable = queries
    .listExpenses(userId)
    .filter((e) => !e.report_id);

  res.render("reports/detail", {
    report,
    expenses,
    attachable,
    statuses: STATUSES,
  });
});

router.get("/:id/pdf", async (req, res, next) => {
  const userId = res.locals.currentUser.id;
  const report = queries.getReport(userId, req.params.id);
  if (!report) return res.status(404).render("error", { message: "Report not found." });
  try {
    const buf = await generateReportPdf(report.id, userId);
    const safeName = report.name.replace(/[^a-z0-9-_]+/gi, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

router.post("/:id", (req, res) => {
  const userId = res.locals.currentUser.id;
  const report = queries.getReport(userId, req.params.id);
  if (!report) return res.status(404).render("error", { message: "Report not found." });
  const name = String(req.body.name || "").trim();
  if (!name) {
    req.flash("error", "Report name is required.");
    return res.redirect("/reports/" + report.id);
  }
  const status = STATUSES.includes(req.body.status) ? req.body.status : report.status;
  db.run(
    `UPDATE reports SET name=?, description=?, purpose=?, status=?, updated_at=datetime('now') WHERE id=? AND user_id=?`,
    name, String(req.body.description || "").trim(), String(req.body.purpose || "").trim(), status, report.id, userId
  );
  req.flash("success", "Report updated.");
  res.redirect("/reports/" + report.id);
});

router.post("/:id/status", (req, res) => {
  const userId = res.locals.currentUser.id;
  const report = queries.getReport(userId, req.params.id);
  if (!report) return res.status(404).render("error", { message: "Report not found." });
  const status = STATUSES.includes(req.body.status) ? req.body.status : report.status;
  db.run("UPDATE reports SET status=?, updated_at=datetime('now') WHERE id=? AND user_id=?", status, report.id, userId);
  req.flash("success", `Status set to ${status}.`);
  res.redirect("/reports/" + report.id);
});

router.post("/:id/attach", (req, res) => {
  const userId = res.locals.currentUser.id;
  const report = queries.getReport(userId, req.params.id);
  if (!report) return res.status(404).render("error", { message: "Report not found." });
  const ids = (Array.isArray(req.body.expense_ids) ? req.body.expense_ids : [req.body.expense_ids])
    .filter(Boolean)
    .map((x) => Number(x))
    .filter(Boolean);
  const stmt = db.open.prepare(
    "UPDATE expenses SET report_id=?, updated_at=datetime('now') WHERE id=? AND user_id=? AND report_id IS NULL"
  );
  for (const id of ids) stmt.run(report.id, id, userId);
  req.flash("success", `${ids.length} expense(s) attached.`);
  res.redirect("/reports/" + report.id);
});

router.post("/:id/detach", (req, res) => {
  const userId = res.locals.currentUser.id;
  const report = queries.getReport(userId, req.params.id);
  if (!report) return res.status(404).render("error", { message: "Report not found." });
  const expenseId = Number(req.body.expense_id);
  if (expenseId) {
    db.run(
      "UPDATE expenses SET report_id=NULL, updated_at=datetime('now') WHERE id=? AND user_id=? AND report_id=?",
      expenseId, userId, report.id
    );
  }
  req.flash("success", "Expense removed from report.");
  res.redirect("/reports/" + report.id);
});

router.post("/:id/delete", (req, res) => {
  const userId = res.locals.currentUser.id;
  const report = queries.getReport(userId, req.params.id);
  if (!report) return res.status(404).render("error", { message: "Report not found." });
  // expenses keep existing (report_id set null via FK ON DELETE SET NULL)
  db.run("DELETE FROM reports WHERE id=? AND user_id=?", report.id, userId);
  req.flash("success", "Report deleted.");
  res.redirect("/reports");
});

module.exports = router;
