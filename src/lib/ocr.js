"use strict";

// OCR via Gemini. One job: take receipt image bytes, return a normalized
// expense object. Uses Gemini's JSON-mode (responseSchema) so output is
// predictable. The standalone bin/ocr-receipt.js wraps this for the shell.

const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("./config");

// Response schema (OpenAPI subset understood by Gemini JSON mode).
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: "string", description: "Business / vendor name as printed." },
    total_amount: {
      type: "number",
      description: "Grand total paid, including tax. Numeric only.",
    },
    currency: {
      type: "string",
      description: "ISO 4217 currency code, e.g. USD, EUR, GBP. Default USD.",
    },
    transaction_date: {
      type: "string",
      description: "Date of the transaction in ISO YYYY-MM-DD. Use the year from the receipt; if none is printed use 2026.",
    },
    category: {
      type: "string",
      description: "Pick the single best match from the provided category list. Use the exact list value.",
    },
    payment_method: {
      type: "string",
      description: "e.g. VISA, Mastercard, Cash, Amex, Debit. Empty if unknown.",
    },
    subtotal: { type: "number", description: "Pre-tax subtotal. 0 if not shown." },
    tax: { type: "number", description: "Tax amount. 0 if not shown." },
    description: {
      type: "string",
      description: "One-line summary of what was purchased (items, count, type of spend).",
    },
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: "number" },
          price: { type: "number" },
        },
      },
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "How readable and complete the receipt is.",
    },
  },
};

function buildPrompt(categories) {
  return [
    "You are an expense-report assistant. Extract structured data from this receipt image.",
    "Rules:",
    "- total_amount is the grand total the customer paid (with tax).",
    "- transaction_date MUST be ISO YYYY-MM-DD.",
    "- currency MUST be an ISO 4217 code.",
    `- category: choose exactly one from this list: ${categories.join(", ")}.`,
    "- If a field is not present or unreadable, use an empty string or 0 — never guess specifics.",
    "- description: a concise human summary of the purchase.",
    "Return only the JSON object.",
  ].join("\n");
}

function client() {
  if (!config.ocrEnabled) return null;
  return new GoogleGenerativeAI(config.geminiApiKey);
}

// Normalizes raw Gemini output into the shape the rest of the app expects.
function normalize(raw, categories) {
  const out = {
    merchant: String(raw.merchant || "").trim(),
    amount: Number(raw.total_amount) || 0,
    currency: String(raw.currency || "USD").trim().toUpperCase() || "USD",
    date: String(raw.transaction_date || "").trim(),
    category: pickCategory(raw.category, categories),
    payment_method: String(raw.payment_method || "").trim(),
    subtotal: Number(raw.subtotal) || 0,
    tax: Number(raw.tax) || 0,
    description: String(raw.description || "").trim(),
    confidence: ["high", "medium", "low"].includes(raw.confidence)
      ? raw.confidence
      : "medium",
    line_items: Array.isArray(raw.line_items) ? raw.line_items : [],
    raw,
  };
  // Sanitize date to YYYY-MM-DD if the model returned something messier.
  out.date = coerceDate(out.date);
  return out;
}

function pickCategory(value, categories) {
  if (!value) return "";
  const v = String(value).trim();
  const lower = categories.map((c) => c.toLowerCase());
  const idx = lower.indexOf(v.toLowerCase());
  if (idx >= 0) return categories[idx];
  // partial match
  const partial = lower.findIndex((c) => c.includes(v.toLowerCase()) || v.toLowerCase().includes(c));
  return partial >= 0 ? categories[partial] : v;
}

function coerceDate(s) {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

/**
 * Extract expense data from a receipt image buffer.
 * @param {Buffer} imageBuffer
 * @param {string} mimeType  e.g. "image/jpeg"
 * @param {{categories: string[]}} opts
 * @returns {Promise<object>} normalized expense fields + raw
 */
async function extract(imageBuffer, mimeType, opts = {}) {
  const ai = client();
  if (!ai) {
    throw new Error("OCR disabled: GEMINI_API_KEY is not set.");
  }
  const categories = (opts.categories && opts.categories.length ? opts.categories : ["Miscellaneous"]);
  const model = ai.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const base64 = imageBuffer.toString("base64");
  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType: mimeType || "image/jpeg" } },
    { text: buildPrompt(categories) },
  ]);
  const text = result.response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  return normalize(parsed, categories);
}

module.exports = { extract, isEnabled: () => config.ocrEnabled };
