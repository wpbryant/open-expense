#!/usr/bin/env node
"use strict";

// generate-icons
//   Renders the PWA app icons (SVG source -> PNG 192/512 + favicon) into
//   public/icons using sharp. Run once after install (or after editing the
//   SVG). Idempotent.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#2563eb"/>
  <rect x="116" y="96" width="280" height="320" rx="24" fill="#ffffff"/>
  <rect x="150" y="140" width="120" height="18" rx="9" fill="#2563eb"/>
  <rect x="150" y="180" width="212" height="12" rx="6" fill="#94a3b8"/>
  <rect x="150" y="210" width="212" height="12" rx="6" fill="#cbd5e1"/>
  <rect x="150" y="240" width="160" height="12" rx="6" fill="#cbd5e1"/>
  <line x1="150" y1="276" x2="362" y2="276" stroke="#e2e8f0" stroke-width="3"/>
  <rect x="150" y="300" width="120" height="14" rx="7" fill="#0f172a"/>
  <text x="362" y="313" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#16a34a" text-anchor="end">$42.80</text>
  <circle cx="256" cy="372" r="34" fill="none" stroke="#16a34a" stroke-width="12"/>
</svg>`;

const outDir = path.resolve(__dirname, "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.svg"), svg);

(async () => {
  await sharp(Buffer.from(svg)).resize(192, 192).png().toFile(path.join(outDir, "icon-192.png"));
  await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(path.join(outDir, "icon-512.png"));
  await sharp(Buffer.from(svg)).resize(180, 180).png().toFile(path.join(outDir, "apple-touch-icon.png"));
  await sharp(Buffer.from(svg)).resize(32, 32).png().toFile(path.join(outDir, "favicon-32.png"));
  process.stdout.write("icons written to public/icons\n");
})().catch((e) => {
  process.stderr.write(`error: ${e.message || e}\n`);
  process.exit(1);
});
