"use strict";

// Composition layer: wires middleware + route modules into one Express app.
// Each concern (auth, receipts, dashboard, expenses, reports, admin) is a
// small module plugged in here.

const path = require("path");
const express = require("express");
const session = require("express-session");

const config = require("./lib/config");
const db = require("./lib/db"); // imported for side-effects (schema/seed)
const ocr = require("./lib/ocr");
const { loadUser, requireAuth, requireAdmin } = require("./middleware/auth");
const flash = require("./middleware/flash");
const { money } = require("./lib/format");

// True if a system executable is on PATH (used to warn about the optional
// poppler/pdftoppm dependency at startup).
function hasBin(bin) {
  try {
    require("child_process").execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "16mb" }));
app.use(
  session({
    name: "oe.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProd,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  })
);
app.use(flash);
app.use(loadUser(db));

// static assets (CSS, JS, manifest, icons, service worker)
app.use(express.static(path.join(__dirname, "..", "public")));

// view locals
app.locals.money = money;
app.locals.appName = "OpenExpense";
app.locals.ocrEnabled = ocr.isEnabled();
app.locals.assetVersion = require("../package.json").version; // cache-bust static assets
const { fileUrl, imgUrl } = require("./lib/urls");
app.locals.fileUrl = fileUrl;
app.locals.imgUrl = imgUrl;
app.use((req, res, next) => {
  res.locals.path = req.path;
  res.locals.now = new Date();
  next();
});

// --- Routes -----------------------------------------------------------------
app.use("/", require("./routes/auth"));
app.use("/", require("./routes/receipts")); // protects itself
app.use("/", require("./routes/dashboard")); // protects itself
app.use("/expenses", requireAuth, require("./routes/expenses"));
app.use("/reports", requireAuth, require("./routes/reports"));
app.use("/admin", requireAuth, requireAdmin, require("./routes/admin"));

// --- Errors -----------------------------------------------------------------

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).render("error", {
    message: config.isProd ? "Something went wrong." : err.message || String(err),
  });
});

if (require.main === module) {
  // touch db to run migrations/seed at boot
  db.all("SELECT COUNT(*) AS n FROM users");
  const server = app.listen(config.port, () => {
    const addr = `http://localhost:${config.port}`;
    // eslint-disable-next-line no-console
    console.log(`OpenExpense running at ${addr}`);
    if (!ocr.isEnabled()) {
      console.log("  [OCR disabled] Set GEMINI_API_KEY to enable receipt scanning.");
    }
    if (!hasBin("pdftoppm")) {
      console.log(
        "  [pdftoppm missing] PDF receipts will still upload/OCR/download but" +
          " won't show a preview or embed in report PDFs. Install poppler-utils."
      );
    }
    console.log(`  Login: ${config.seedAdmin.username} / ${config.seedAdmin.password}`);
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}

module.exports = app;
