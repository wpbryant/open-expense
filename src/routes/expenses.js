"use strict";

// Expenses CRUD. Each user only sees/edits their own expenses.

const express = require("express");
const db = require("../lib/db");
const queries = require("../lib/queries");
const receipts = require("../lib/receipts");
const { fileUrl, imgUrl } = require("../lib/urls");

const router = express.Router();

function parseExpense(body) {
  return {
    amount: Number(String(body.amount || "").replace(/[^0-9.]/g, "")) || 0,
    currency: String(body.currency || "USD").toUpperCase() || "USD",
    date: String(body.date || ""),
    merchant: String(body.merchant || "").trim(),
    description: String(body.description || "").trim(),
    category: String(body.category || "").trim(),
    payment_method: String(body.payment_method || "").trim(),
    report_id: body.report_id ? Number(body.report_id) : null,
    receipt_path: String(body.receipt_path || "").trim() || null,
  };
}

function validate(e) {
  const errors = [];
  if (!e.date) errors.push("Date is required.");
  if (!e.merchant) errors.push("Merchant is required.");
  if (!(e.amount >= 0)) errors.push("Amount must be a non-negative number.");
  return errors;
}

// --- List -------------------------------------------------------------------

router.get("/", (req, res) => {
  const userId = res.locals.currentUser.id;
  const { report, category, q } = req.query;
  let rows = queries.listExpenses(userId);

  if (report === "unfiled") rows = rows.filter((e) => !e.report_id);
  else if (report) rows = rows.filter((e) => String(e.report_id) === String(report));
  if (category) rows = rows.filter((e) => e.category === category);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(
      (e) =>
        e.merchant.toLowerCase().includes(needle) ||
        e.description.toLowerCase().includes(needle)
    );
  }

  const total = rows.reduce((a, e) => a + (e.amount || 0), 0);
  res.render("expenses/index", {
    expenses: rows,
    total,
    filters: { report: report || "", category: category || "", q: q || "" },
    categories: queries.categories(),
    reports: queries.reportsWithTotals(userId),
  });
});

// --- Create -----------------------------------------------------------------

router.get("/new", (req, res) => {
  res.render("expenses/form", {
    title: "Add expense",
    isNew: true,
    fromScan: false,
    receiptPath: null,
    receiptPreview: null,
    ocrConfidence: null,
    ocrError: null,
    expense: {
      merchant: "",
      amount: "",
      currency: "USD",
      date: req.query.date || today(),
      category: req.query.category || "",
      payment_method: "",
      description: "",
      report_id: req.query.report || "",
    },
    categories: queries.categories(),
    reports: queries.reportsWithTotals(res.locals.currentUser.id),
  });
});

router.post("/", (req, res) => {
  const userId = res.locals.currentUser.id;
  const e = parseExpense(req.body);
  const errors = validate(e);
  if (errors.length) {
    return renderExpenseForm(res, { title: "Add expense", isNew: true, expense: e, errors });
  }
  if (e.report_id) {
    const owned = db.get("SELECT id FROM reports WHERE id = ? AND user_id = ?", e.report_id, userId);
    if (!owned) e.report_id = null;
  }
  const info = db.run(
    `INSERT INTO expenses
      (user_id, report_id, amount, currency, date, merchant, description, category, payment_method, receipt_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, e.report_id, e.amount, e.currency, e.date, e.merchant, e.description, e.category, e.payment_method, e.receipt_path
  );
  req.flash("success", "Expense added.");
  res.redirect("/expenses/" + info.lastInsertRowid + "/edit");
});

// --- Update / Delete --------------------------------------------------------

router.get("/:id/edit", (req, res) => {
  const userId = res.locals.currentUser.id;
  const expense = queries.getExpense(userId, req.params.id);
  if (!expense) return res.status(404).render("error", { message: "Expense not found." });
  res.render("expenses/form", {
    title: "Edit expense",
    isNew: false,
    fromScan: false,
    receiptPath: expense.receipt_path,
    receiptPreview: imgUrl(expense.receipt_path) || null,
    receiptDownload: fileUrl(expense.receipt_path) || null,
    receiptIsPdf: receipts.isPdf(expense.receipt_path),
    ocrConfidence: expense.ocr_confidence,
    ocrError: null,
    expense,
    categories: queries.categories(),
    reports: queries.reportsWithTotals(userId),
  });
});

router.post("/:id", (req, res) => {
  const userId = res.locals.currentUser.id;
  const existing = queries.getExpense(userId, req.params.id);
  if (!existing) return res.status(404).render("error", { message: "Expense not found." });
  const e = parseExpense(req.body);
  const errors = validate(e);
  if (errors.length) {
    e.id = existing.id;
    return renderExpenseForm(res, { title: "Edit expense", isNew: false, expense: e, errors });
  }
  if (e.report_id) {
    const owned = db.get("SELECT id FROM reports WHERE id = ? AND user_id = ?", e.report_id, userId);
    if (!owned) e.report_id = null;
  }
  // Keep any previously attached receipt if the form didn't supply one.
  const receiptPath = e.receipt_path || existing.receipt_path || null;
  db.run(
    `UPDATE expenses SET
       amount=?, currency=?, date=?, merchant=?, description=?, category=?,
       payment_method=?, report_id=?, receipt_path=?, updated_at=datetime('now')
     WHERE id=? AND user_id=?`,
    e.amount, e.currency, e.date, e.merchant, e.description, e.category,
    e.payment_method, e.report_id, receiptPath, existing.id, userId
  );
  req.flash("success", "Expense saved.");
  res.redirect("/expenses/" + existing.id + "/edit");
});

router.post("/:id/delete", (req, res) => {
  const userId = res.locals.currentUser.id;
  const existing = queries.getExpense(userId, req.params.id);
  if (!existing) return res.status(404).render("error", { message: "Expense not found." });
  if (existing.receipt_path) receipts.deleteFile(existing.receipt_path);
  db.run("DELETE FROM expenses WHERE id=? AND user_id=?", existing.id, userId);
  req.flash("success", "Expense deleted.");
  res.redirect("/expenses");
});

// helper for re-rendering the form with validation errors
function renderExpenseForm(res, { title, isNew, expense, errors }) {
  res.status(422).render("expenses/form", {
    title,
    isNew,
    fromScan: false,
    receiptPath: expense.receipt_path || null,
    receiptPreview: imgUrl(expense.receipt_path) || null,
    receiptDownload: fileUrl(expense.receipt_path) || null,
    receiptIsPdf: receipts.isPdf(expense.receipt_path),
    ocrConfidence: expense.ocr_confidence || null,
    ocrError: null,
    expense,
    categories: queries.categories(),
    reports: queries.reportsWithTotals(res.locals.currentUser.id),
    errors,
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = router;
