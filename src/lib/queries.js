"use strict";

// Repeated read queries, in one place. Keeps route handlers thin.

const db = require("./db");

function categories() {
  return db.all("SELECT name FROM categories ORDER BY name").map((c) => c.name);
}

function listExpenses(userId, { reportId } = {}) {
  if (reportId === undefined) {
    return db.all(
      `SELECT e.*, r.name AS report_name
       FROM expenses e LEFT JOIN reports r ON r.id = e.report_id
       WHERE e.user_id = ? ORDER BY e.date DESC, e.id DESC`,
      userId
    );
  }
  return db.all(
    `SELECT e.*, r.name AS report_name
     FROM expenses e LEFT JOIN reports r ON r.id = e.report_id
     WHERE e.user_id = ? AND e.report_id IS ? ORDER BY e.date DESC, e.id DESC`,
    userId,
    reportId
  );
}

function getExpense(userId, id) {
  return db.get("SELECT * FROM expenses WHERE id = ? AND user_id = ?", id, userId);
}

function reportsWithTotals(userId) {
  return db.all(
    `SELECT r.*,
       COUNT(e.id) AS expense_count,
       COALESCE(SUM(e.amount), 0) AS total
     FROM reports r
     LEFT JOIN expenses e ON e.report_id = r.id
     WHERE r.user_id = ?
     GROUP BY r.id
     ORDER BY r.id DESC`,
    userId
  );
}

function getReport(userId, id) {
  return db.get(
    `SELECT r.*,
       COUNT(e.id) AS expense_count,
       COALESCE(SUM(e.amount), 0) AS total
     FROM reports r
     LEFT JOIN expenses e ON e.report_id = r.id
     WHERE r.id = ? AND r.user_id = ?
     GROUP BY r.id`,
    id,
    userId
  );
}

function reportExpenses(reportId, userId) {
  return db.all(
    userId
      ? "SELECT * FROM expenses WHERE report_id = ? AND user_id = ? ORDER BY date, id"
      : "SELECT * FROM expenses WHERE report_id = ? ORDER BY date, id",
    reportId,
    ...(userId ? [userId] : [])
  );
}

function dashboardStats(userId) {
  const totals = db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE user_id = ?`,
    userId
  );
  const unreported = db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
     FROM expenses WHERE user_id = ? AND report_id IS NULL`,
    userId
  );
  // Unsubmitted = unfiled, OR attached to a report that's still in draft.
  const unsubmitted = db.get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
       FROM expenses e
      WHERE e.user_id = ?
        AND (e.report_id IS NULL
             OR EXISTS (SELECT 1 FROM reports r WHERE r.id = e.report_id AND r.status = 'draft'))`,
    userId
  );
  const byCategory = db.all(
    `SELECT IFNULL(NULLIF(category,''),'Uncategorized') AS category,
            COUNT(*) AS count,
            COALESCE(SUM(amount), 0) AS total
     FROM expenses WHERE user_id = ?
     GROUP BY category ORDER BY total DESC`,
    userId
  );
  const recent = db.all(
    "SELECT * FROM expenses WHERE user_id = ? ORDER BY id DESC LIMIT 6",
    userId
  );
  const reports = reportsWithTotals(userId).slice(0, 5);
  return { totals, unreported, unsubmitted, byCategory, recent, reports };
}

// Global stats for the admin panel (across all users).
function adminStats() {
  const users = db.get("SELECT COUNT(*) AS n FROM users");
  const expenses = db.get("SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM expenses");
  const reports = db.get("SELECT COUNT(*) AS count FROM reports");
  const byUser = db.all(
    `SELECT u.username, u.is_admin,
            COUNT(DISTINCT e.id) AS expense_count,
            COALESCE(SUM(e.amount), 0) AS total
     FROM users u
     LEFT JOIN expenses e ON e.user_id = u.id
     GROUP BY u.id ORDER BY total DESC`
  );
  return { users: users.n, expenses, reports, byUser };
}

module.exports = {
  categories,
  listExpenses,
  getExpense,
  reportsWithTotals,
  getReport,
  reportExpenses,
  dashboardStats,
  adminStats,
};
