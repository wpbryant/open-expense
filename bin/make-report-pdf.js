#!/usr/bin/env node
"use strict";

// make-report-pdf <report-id> [--out path]
//   Builds an expense report PDF (with embedded receipts) and writes it to
//   --out (default ./report-<id>.pdf). Prints the output path when done.

const path = require("path");
const fs = require("fs");
const { generateReportPdf } = require("../src/lib/pdf");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const idStr = process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);
  const reportId = parseInt(idStr, 10);
  if (!reportId) {
    process.stderr.write("usage: make-report-pdf <report-id> [--out path]\n");
    process.exit(2);
  }
  const out = path.resolve(arg("--out") || `report-${reportId}.pdf`);
  const buf = await generateReportPdf(reportId);
  fs.writeFileSync(out, buf);
  process.stdout.write(out + "\n");
}

main().catch((e) => {
  process.stderr.write(`error: ${e.message || e}\n`);
  process.exit(1);
});
