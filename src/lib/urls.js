"use strict";

// URL builders for receipt files, shared by routes and templates.
//   fileUrl(rel) -> raw file (download / open) for the owner
//   imgUrl(rel)  -> an <img>-safe URL (rasterized PNG for PDFs, file for images)
// Both enforce ownership server-side via the /receipt/file route.

const receipts = require("./receipts");

function fileUrl(rel) {
  return rel ? "/receipt/file?path=" + encodeURIComponent(rel) : "";
}

function imgUrl(rel) {
  if (!rel) return "";
  const base = "/receipt/file?path=" + encodeURIComponent(rel);
  return receipts.isPdf(rel) ? base + "&render=image" : base;
}

module.exports = { fileUrl, imgUrl };
