"use strict";

// Receipt file storage. Everything is a file under receiptsDir, sharded by
// user so one account can never read another's receipts.
//
//   data/receipts/<userId>/YYYY/MM/<rand>-<safe>.jpg   <- images (normalized)
//   data/receipts/<userId>/YYYY/MM/<rand>-<safe>.pdf   <- PDF receipts (raw)
//   data/receipts/<userId>/YYYY/MM/<rand>-<safe>.png   <- first page raster of a PDF
//
// PDFs are stored raw (Gemini reads them natively for best accuracy) and a
// first-page PNG is rasterized alongside for previews / thumbnails / PDF embed.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { execFile } = require("child_process");
const sharp = require("sharp");
const config = require("./config");

const execFileAsync = promisify(execFile);

function ensureDir() {
  if (!fs.existsSync(config.receiptsDir)) {
    fs.mkdirSync(config.receiptsDir, { recursive: true });
  }
}

function sanitize(originalName) {
  return (originalName || "receipt").replace(/[^a-z0-9._-]+/gi, "_").replace(/^[-_.]+/, "").slice(0, 40);
}

function relPathFor(userId, originalName, ext) {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const rand = crypto.randomBytes(6).toString("hex");
  const safe = sanitize(originalName) || "receipt";
  return path.posix.join(String(userId), ym, `${rand}-${safe}.${ext}`);
}

function absPath(rel) {
  return rel ? path.resolve(config.receiptsDir, rel) : "";
}

function isPdf(rel) {
  return Boolean(rel) && /\.pdf$/i.test(rel);
}

// Rasterize the first page of a PDF to a PNG sitting next to it (same basename).
async function rasterizeFirstPage(pdfAbs) {
  const outPrefix = pdfAbs.replace(/\.pdf$/i, "");
  await execFileAsync("pdftoppm", [
    "-png", "-singlefile", "-r", "150", "-f", "1", "-l", "1",
    pdfAbs, outPrefix,
  ]);
  return `${outPrefix}.png`;
}

/**
 * Persist a receipt for a user. Images are normalized to compact JPEG; PDFs are
 * stored raw and rasterized. Returns the stored relative path (the canonical file).
 */
async function save(buffer, originalName, mimeType, userId) {
  ensureDir();
  const looksLikePdf =
    mimeType === "application/pdf" || /\.pdf$/i.test(originalName || "");

  if (looksLikePdf) {
    const rel = relPathFor(userId, originalName, "pdf");
    const abs = absPath(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
    try {
      await rasterizeFirstPage(abs);
    } catch {
      // no poppler/failed — preview will simply be unavailable; OCR still works
    }
    return rel;
  }

  const rel = relPathFor(userId, originalName, "jpg");
  const abs = absPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  try {
    await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width: 1600, height: 2200, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#fff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(abs);
  } catch {
    fs.writeFileSync(abs, buffer); // fall back to original bytes
  }
  return rel;
}

// Path to a renderable image for a stored receipt (the rasterized PNG for PDFs,
// the file itself for images). May not exist if rasterization failed.
function previewPath(rel) {
  if (!rel) return null;
  return isPdf(rel) ? rel.replace(/\.pdf$/i, ".png") : rel;
}

function mimeForPath(rel) {
  if (!rel) return "application/octet-stream";
  return isPdf(rel) ? "application/pdf" : "image/jpeg";
}

function readBuffer(rel) {
  return fs.readFileSync(absPath(rel));
}

function exists(rel) {
  return Boolean(rel) && fs.existsSync(absPath(rel));
}

// Verify a stored path belongs to `userId` (isolation guard).
function belongsToUser(rel, userId) {
  if (!rel) return false;
  const abs = absPath(rel);
  const under = path.relative(config.receiptsDir, abs);
  if (!under || under.startsWith("..") || path.isAbsolute(under)) return false;
  const first = under.split(path.sep)[0];
  return first === String(userId);
}

function deleteFile(rel) {
  if (!rel) return;
  for (const p of [absPath(rel), absPath(previewPath(rel))]) {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
}

module.exports = {
  save,
  saveNormalized: save, // backwards-compat alias
  readBuffer,
  exists,
  deleteFile,
  absPath,
  previewPath,
  mimeForPath,
  isPdf,
  belongsToUser,
  rasterizeFirstPage,
};
