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
    drawSummaryTable(doc, expenses, currency);
    for (const e of expenses) drawExpensePage(doc, e);
    doc.end();
  });
}

function drawHeader(doc, report, preparedBy, currency, total, range, count) {
  doc
    .fillColor(ACCENT)
    .fontSize(22)
    .font("Helvetica-Bold")
    .text("Expense Report", { continued: false });

  doc.moveDown(0.3);
  doc.fillColor("#111").fontSize(15).font("Helvetica-Bold").text(report.name);

  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10).fillColor("#444");
  field(doc, "Status", statusLabel(report.status));
  field(doc, "Prepared by", preparedBy || "—");
  field(doc, "Period", range);
  field(doc, "Expenses", String(count));
  field(doc, "Purpose", report.purpose || "—");

  doc.moveDown(0.4);
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(ACCENT)
    .text(`Total: ${money(total, currency)}`);

  doc
    .moveDown(0.2)
    .strokeColor("#ddd")
    .moveTo(doc.x, doc.y)
    .lineTo(doc.page.width - PAGE.margin, doc.y)
    .stroke();

  doc.moveDown(0.6);
}

function statusLabel(s) {
  return ({ draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected" })[s] || s;
}

function field(doc, label, value) {
  doc.font("Helvetica-Bold").fillColor("#666").text(label + ": ", { continued: true });
  doc.font("Helvetica").fillColor("#222").text(String(value));
}

function drawSummaryTable(doc, expenses, currency) {
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text("Summary");
  doc.moveDown(0.3);

  const left = PAGE.margin;
  const tableW = doc.page.width - PAGE.margin * 2;
  // Column widths sum to tableW (LETTER 612 - 2*50 = 512).
  const cols = [
    { key: "date", label: "Date", w: 64 },
    { key: "merchant", label: "Merchant", w: 124 },
    { key: "category", label: "Category", w: 104 },
    { key: "description", label: "Description", w: 148 },
    { key: "amount", label: "Amount", w: 72, align: "right" },
  ];
  const padY = 4;
  const headerH = 18;

  const cellText = (e, c) => {
    let v = e[c.key];
    if (c.key === "amount") v = money(e.amount, currency);
    return String(v == null ? "" : v);
  };

  // header row
  let y = doc.y;
  doc.rect(left, y, tableW, headerH).fill(ACCENT);
  let x = left;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#fff");
  cols.forEach((c) => {
    doc.text(c.label, x + 3, y + 5, { width: c.w - 6, align: c.align || "left" });
    x += c.w;
  });
  y += headerH;

  // body — rows expand to fit wrapped content (no truncation)
  doc.font("Helvetica").fontSize(9);
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
  const totalW = cols[0].w + cols[1].w + cols[2].w + cols[3].w;
  const amountX = left + totalW;
  doc.rect(left, y, tableW, headerH).fill("#e2e8f0");
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111");
  doc.text("Total", left + 3, y + 5, { width: totalW - 6 });
  doc.text(money(total, currency), amountX + 3, y + 5, {
    width: cols[4].w - 6,
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

  if (receipts.exists(e.receipt_path)) {
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
  } else {
    doc.fillColor("#999").fontSize(9).text("(no receipt attached)");
  }
}

function kv(doc, label, value) {
  doc.font("Helvetica-Bold").fillColor("#666").text(label + ": ", { continued: true });
  doc.font("Helvetica").fillColor("#222").text(String(value));
}

module.exports = { generateReportPdf };
