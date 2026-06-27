"use strict";

// Tiny content-type sniffer for the bin tools (keeps them self-contained).

const path = require("path");

const exts = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".pdf": "application/pdf",
};

function fromPath(p) {
  return exts[path.extname(p).toLowerCase()] || "application/octet-stream";
}

function fromBuffer(buf) {
  if (!buf || buf.length < 4) return "application/octet-stream";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return "application/octet-stream";
}

module.exports = { fromPath, fromBuffer };
