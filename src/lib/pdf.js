"use strict";

// Expense report -> PDF. One job: lay out a report and its expenses (with
// embedded receipt images) into a clean, printable PDF buffer.
// The standalone bin/make-report-pdf.js wraps this for the shell.

const PDFDocument = require("pdfkit");
const db = require("./db");
const receipts = require("./receipts");
const { money } = require("./format");

const PAGE = { size: "LETTER", margin: 50 };
const ACCENT = "#2563eb";
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

function fmtTotal(amounts, currency) {
  const total = amounts.reduce((a, b) => a + (b.amount || 0), 0);
  return money(total, currency);
}

/**
 * Build a PDF for a report (and all expenses attached to it).
 * @param {number} reportId
 * @param {number} [userId]  optional owner scope (omit only in trusted CLIs)
 * @returns {Promise<Buffer>}
 */
async function generateReportPdf(reportId, userId) {
  const report = db.get(
    userId
      ? "SELECT * FROM reports WHERE id = ? AND user_id = ?"
      : "SELECT * FROM reports WHERE id = ?",
    ...(userId ? [reportId, userId] : [reportId])
  );
  if (!report) throw new Error(`Report ${reportId} not found`);

  const owner = db.get("SELECT username, first_name, last_name FROM users WHERE id = ?", report.user_id);
  const expenses = db.all(
    userId
      ? "SELECT * FROM expenses WHERE report_id = ? AND user_id = ? ORDER BY date, id"
      : "SELECT * FROM expenses WHERE report_id = ? ORDER BY date, id",
    ...(userId ? [reportId, userId] : [reportId])
  );

  const currency = (expenses[0] && expenses[0].currency) || "USD";
  const total = expenses.reduce((a, e) => a + (e.amount || 0), 0);
  const dates = expenses
    .map((e) => e.date)
    .filter(Boolean)
    .sort();
  const range =
    dates.length === 0
      ? "—"
      : dates.length === 1
      ? dates[0]
      : `${dates[0]} to ${dates[dates.length - 1]}`;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(PAGE);
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const preparedBy = owner
      ? [owner.first_name, owner.last_name].filter(Boolean).join(" ") || owner.username
      : "—";
    drawHeader(doc, report, preparedBy, currency, total, range, expenses.length);
    drawSummaryTable(doc, expenses, currency, report, preparedBy);
    // One detail page per expense that has a receipt attached. Expenses
    // without a receipt appear only in the summary table above.
    for (const e of expenses) {
      if (receipts.exists(e.receipt_path)) drawExpensePage(doc, e);
    }
    doc.end();
  });
}

function drawHeader(doc, report, preparedBy, currency, total, range, count) {
  const left = PAGE.margin;
  const right = doc.page.width - PAGE.margin;
  const contentW = right - left;
  const colW = 250;
  const col2X = right - colW;
  const y0 = doc.y;

  // Title band: document title on the left, total mirrored as a figure on the right.
  doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT);
  doc.text("EXPENSE REPORT", left, y0, { width: colW });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK);
  doc.text(report.name || "Untitled report", left, y0 + 14, { width: colW });
  const bandLeft = doc.y;

  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
  doc.text("TOTAL", col2X, y0, { width: colW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(22).fillColor(ACCENT);
  doc.text(money(total, currency), col2X, y0 + 12, { width: colW, align: "right" });
  const bandRight = doc.y;

  let y = Math.max(bandLeft, bandRight) + 16;

  // Metadata grid: two fields per row keeps the header compact.
  y = metaRow(doc, y, colW, left, col2X, "Status", statusLabel(report.status), "Period", range);
  y = metaRow(doc, y, colW, left, col2X, "Prepared by", preparedBy || "—", "Expenses", String(count));
  // Purpose is free text, so give it the full width.
  y = metaField(doc, left, y, contentW, "Purpose", report.purpose || "—") + 6;

  // Hairline separating the header from the summary table.
  doc.strokeColor(LINE).lineWidth(1);
  doc.moveTo(left, y).lineTo(right, y).stroke();

  doc.x = left;
  doc.y = y + 12;
}

function statusLabel(s) {
  return ({ draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected", reimbursed: "Reimbursed" })[s] || s;
}

// One inline "LABEL: value" field within a column of width w. Returns the
// cursor y after the (possibly wrapped) line.
function metaField(doc, x, y, w, label, value) {
  const val = String(value == null ? "" : value);
  doc.x = x;
  doc.y = y;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(MUTED);
  doc.text(label.toUpperCase() + ":", { width: w, continued: true });
  doc.font("Helvetica").fillColor(INK);
  doc.text(" " + val, { width: w });
  return doc.y;
}

// Two side-by-side fields on one row; returns the y for the next row.
function metaRow(doc, y, w, x1, x2, l1, v1, l2, v2) {
  const b1 = metaField(doc, x1, y, w, l1, v1);
  const b2 = v2 === undefined || v2 === null ? y : metaField(doc, x2, y, w, l2, v2);
  return Math.max(b1, b2) + 6;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2026-07-13" -> "13July2026" (day unpadded, full month name, full year).
// Parsed manually — new Date("YYYY-MM-DD") is UTC and can shift the day in
// some timezones.
function expenseDateToken(iso) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return String(Number(m[3])) + MONTHS[Number(m[2]) - 1] + m[1];
}

// Combined narrative for the summary table's "Description" column, in the
// requested order. Blank components are skipped and the rest joined with ", ".
// `ownerName`, `report.purpose/project_name/product_in_focus` are constant per
// report; category / date / chargeable_to / description vary per expense.
function combinedDescription(e, report, ownerName) {
  const parts = [
    ownerName,
    e.category,
    report.purpose,
    report.project_name,
    expenseDateToken(e.date),
    report.product_in_focus,
    e.chargeable_to ? "Chargeable To " + e.chargeable_to : "",
    e.description,
  ];
  return parts
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter((p) => p !== "")
    .join(", ");
}

function drawSummaryTable(doc, expenses, currency, report, ownerName) {
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text("Summary");
  doc.moveDown(0.3);

  const left = PAGE.margin;
  const tableW = doc.page.width - PAGE.margin * 2;
  // Column widths sum to tableW (LETTER 612 - 2*50 = 512). The Description
  // column carries the combined narrative, so it gets the bulk of the width.
  const cols = [
    { key: "date", label: "Date", w: 60 },
    { key: "merchant", label: "Merchant", w: 90 },
    { key: "description", label: "Description", w: 290 },
    { key: "amount", label: "Amount", w: 72, align: "right" },
  ];
  const padY = 4;
  const headerH = 18;

  const cellText = (e, c) => {
    if (c.key === "amount") return money(e.amount, currency);
    if (c.key === "description") return combinedDescription(e, report, ownerName);
    return String(e[c.key] == null ? "" : e[c.key]);
  };

  // header row
  let y = doc.y;
  doc.rect(left, y, tableW, headerH).fill(ACCENT);
  let x = left;
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#fff");
  cols.forEach((c) => {
    doc.text(c.label, x + 3, y + 5, { width: c.w - 6, align: c.align || "left" });
    x += c.w;
  });
  y += headerH;

  // body — rows expand to fit wrapped content (no truncation)
  doc.font("Helvetica").fontSize(8);
  for (let i = 0; i < expenses.length; i++) {
    const e = expenses[i];
    const heights = cols.map((c) =>
      doc.heightOfString(cellText(e, c), { width: c.w - 6 })
    );
    const rowH = Math.max(...heights) + padY * 2;

    if (y + rowH > doc.page.height - PAGE.margin) {
      doc.addPage();
      y = PAGE.margin;
    }
    if (i % 2 === 1) doc.rect(left, y, tableW, rowH).fill("#f3f4f6");

    let xx = left;
    doc.fillColor("#222");
    cols.forEach((c) => {
      doc.text(cellText(e, c), xx + 3, y + padY, {
        width: c.w - 6,
        align: c.align || "left",
      });
      xx += c.w;
    });
    y += rowH;
  }

  // total row
  const total = expenses.reduce((a, e) => a + (e.amount || 0), 0);
  if (y + headerH > doc.page.height - PAGE.margin) {
    doc.addPage();
    y = PAGE.margin;
  }
  const totalW = cols[0].w + cols[1].w + cols[2].w;
  const amountX = left + totalW;
  doc.rect(left, y, tableW, headerH).fill("#e2e8f0");
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#111");
  doc.text("Total", left + 3, y + 5, { width: totalW - 6 });
  doc.text(money(total, currency), amountX + 3, y + 5, {
    width: cols[3].w - 6,
    align: "right",
  });
  doc.y = y + headerH + 14;
  doc.font("Helvetica");
}

function drawExpensePage(doc, e) {
  doc.addPage();
  doc
    .fillColor(ACCENT)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(`${e.merchant || "Expense"} — ${money(e.amount, e.currency)}`);
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor("#333");
  kv(doc, "Date", e.date);
  kv(doc, "Category", e.category);
  kv(doc, "Payment method", e.payment_method || "—");
  kv(doc, "Description", e.description || "—");
  doc.moveDown(0.4);

  // drawExpensePage is only called for expenses with a receipt, so embed it
  // directly. The try/catch covers a missing preview (e.g. PDF rasterization
  // failed) without leaving a blank page.
  doc.fillColor("#666").fontSize(9).text("Receipt:");
  doc.moveDown(0.2);
  try {
    // Embed a renderable image (rasterized PNG for PDFs, the JPEG otherwise).
    const renderPath = receipts.previewPath(e.receipt_path);
    const buf = receipts.readBuffer(renderPath);
    const maxW = doc.page.width - PAGE.margin * 2;
    const maxH = doc.page.height - doc.y - PAGE.margin - 10;
    doc.image(buf, { fit: [maxW, maxH], align: "center" });
  } catch {
    doc.fillColor("#b00").text("(receipt image could not be embedded)");
  }
}

function kv(doc, label, value) {
  doc.font("Helvetica-Bold").fillColor("#666").text(label + ": ", { continued: true });
  doc.font("Helvetica").fillColor("#222").text(String(value));
}

module.exports = { generateReportPdf };
