"use strict";

// Receipt upload + OCR ("SmartScan") and receipt file serving.
// The scan flow is the Expensify-like path: upload -> OCR pre-fills an
// expense form -> user reviews -> submits (handled by /expenses).

const express = require("express");
const path = require("path");
const multer = require("multer");
const config = require("../lib/config");
const { requireAuth } = require("../middleware/auth");
const receipts = require("../lib/receipts");
const ocr = require("../lib/ocr");
const queries = require("../lib/queries");
const { fileUrl, imgUrl } = require("../lib/urls");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype) || file.mimetype === "application/pdf") {
      return cb(null, true);
    }
    cb(null, false);
  },
});

router.use(requireAuth);

router.get("/receipts/scan", (req, res) => {
  res.render("receipts/scan", {
    ocrEnabled: ocr.isEnabled(),
    presetReport: req.query.report || "",
    error: (res.locals.messages.error && res.locals.messages.error[0]) || null,
  });
});

// Upload -> save -> OCR -> pre-fill expense form for review.
router.post("/receipts/scan", upload.single("receipt"), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash("error", "Please choose an image or PDF receipt to upload.");
      return res.redirect("/receipts/scan");
    }
    const userId = res.locals.currentUser.id;
    const mime = req.file.mimetype || (receipts.isPdf(req.file.originalname) ? "application/pdf" : "image/jpeg");
    const receiptPath = await receipts.save(req.file.buffer, req.file.originalname, mime, userId);

    let fields = null;
    let ocrError = null;
    if (ocr.isEnabled()) {
      try {
        // OCR the canonical stored file (raw PDF for PDFs, normalized JPEG for images).
        const ocrMime = receipts.isPdf(receiptPath) ? "application/pdf" : "image/jpeg";
        fields = await ocr.extract(receipts.readBuffer(receiptPath), ocrMime, {
          categories: queries.categories(),
        });
      } catch (e) {
        ocrError = e.message || String(e);
      }
    }

    const f = fields || {};
    const report_id = req.body.report_id || "";
    const expense = {
      merchant: f.merchant || "",
      amount: f.amount ? String(f.amount) : "",
      currency: f.currency || "USD",
      date: f.date || "",
      category: f.category || "",
      payment_method: f.payment_method || "",
      description: f.description || "",
      report_id,
    };

    res.render("expenses/form", {
      title: "Review scanned expense",
      isNew: true,
      fromScan: true,
      receiptPath,
      receiptPreview: imgUrl(receiptPath),
      receiptDownload: fileUrl(receiptPath),
      receiptIsPdf: receipts.isPdf(receiptPath),
      ocrConfidence: fields ? fields.confidence : null,
      ocrError,
      expense,
      categories: queries.categories(),
      reports: queries.reportsWithTotals(userId),
    });
  } catch (e) {
    next(e);
  }
});

// Serve a stored receipt. Path must belong to the requesting user (isolation).
// ?render=image returns the rasterized PNG for PDFs (for <img> / PDF embedding).
// ?download=1 forces a download with the original filename.
router.get("/receipt/file", (req, res) => {
  const rel = String(req.query.path || "");
  if (!receipts.belongsToUser(rel, res.locals.currentUser.id)) {
    return res.status(404).send("not found");
  }

  let target = receipts.absPath(rel);
  if (req.query.render === "image" && receipts.isPdf(rel)) {
    const png = receipts.absPath(receipts.previewPath(rel));
    if (png && require("fs").existsSync(png)) target = png;
    else return res.status(404).send("preview unavailable");
  }
  if (!require("fs").existsSync(target)) {
    return res.status(404).send("not found");
  }

  const ct = target.endsWith(".pdf") ? "application/pdf" : target.endsWith(".png") ? "image/png" : "image/jpeg";
  res.setHeader("Content-Type", ct);
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (req.query.download === "1") {
    const base = path.basename(rel);
    res.setHeader("Content-Disposition", `attachment; filename="${base}"`);
  }
  require("fs").createReadStream(target).pipe(res);
});

module.exports = router;
