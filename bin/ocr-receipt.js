#!/usr/bin/env node
"use strict";

// ocr-receipt <image-path>
//   Reads a receipt image, extracts structured expense data via Gemini,
//   prints JSON to stdout. Unix-style: one job, text out.
//
//   GEMINI_API_KEY=... node bin/ocr-receipt.js ./receipt.jpg | jq .

const fs = require("fs");
const path = require("path");
const { extract, isEnabled } = require("../src/lib/ocr");
const db = require("../src/lib/db");
const mime = require("./_mime");

async function main() {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("usage: ocr-receipt <image-path>\n");
    process.exit(2);
  }
  if (!isEnabled()) {
    process.stderr.write("error: GEMINI_API_KEY is not set. OCR disabled.\n");
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    process.stderr.write(`error: file not found: ${abs}\n`);
    process.exit(1);
  }

  const categories = db.all("SELECT name FROM categories ORDER BY name").map((c) => c.name);
  const buffer = fs.readFileSync(abs);
  const result = await extract(buffer, mime.fromPath(abs), { categories });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`error: ${e.message || e}\n`);
  process.exit(1);
});
