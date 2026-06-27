"use strict";

// Small formatting helpers shared across views and PDF.

const currencySymbols = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "C$", AUD: "A$", INR: "₹",
};

function money(amount, currency = "USD") {
  const n = Number(amount) || 0;
  const sym = currencySymbols[currency] || "";
  const str = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sym}${str}`;
}

// Plain number (no symbol) for input fields.
function num(amount) {
  return (Number(amount) || 0).toFixed(2);
}

module.exports = { money, num };
