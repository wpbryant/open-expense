# OpenExpense

A small, composable **expense-tracking PWA** in the spirit of Expensify / SAP Concur —
but local-first and tiny. Upload a receipt, let **Gemini** read it into an expense,
group expenses into reports, and **export to PDF** (with the receipts embedded).

- 📷 Scan a receipt (image **or PDF**) → OCR pre-fills the expense form for review
- 🚗 **Mileage expenses** — build a route from addresses, get the driving distance
  (Google), and attach a **route map** as the receipt; works fully manual without a key
- ✂️ Crop receipt images right on the expense page — the server cuts them with `sharp` (image receipts; PDFs excluded)
- ✍️ Add / edit expenses manually; filter, search, attach to reports
- 📁 Group expenses into reports, set status (draft → submitted → approved)
- 📄 Download a report as a PDF — clean two-column header, summary table, and a receipt page per expense that has one
- 📊 Dashboard with unsubmitted/unfiled totals and a category breakdown
- 🛠 Admin panel: users (name + email) + categories
- 🔑 Admin-only password resets (emailed link) — deliberately never on the login page
- 🔐 Username/password login; **expenses, reports, and receipts are isolated per user**
- 📱 Installable PWA with a mobile slide-out nav

![alt text](<Screenshot from 2026-06-29 21-27-14.png>)

## Prerequisites

- **Node.js 20+**
- **A C/C++ toolchain** (or matching prebuilt binaries) so `npm install` can build
  the native modules `better-sqlite3`, `bcrypt`, and `sharp`. On Debian/Ubuntu:
  `sudo apt-get install build-essential python3`.
- **poppler-utils** (provides the `pdftoppm` command) — **optional but recommended**
  for PDF receipts. `npm install` does **not** install this; use your OS package
  manager (`sudo apt-get install poppler-utils`, `brew install poppler`, …).
  - *Without it*, PDF receipts still upload, OCR (Gemini reads PDFs natively),
    and download — they just lose the in-app image preview/thumbnail and are not
    embedded in the exported report PDF. Image receipts are unaffected.

## Quick start

```bash
npm install
cp .env.example .env      # optional but recommended — edit settings/keys
npm start
```

Open <http://localhost:3000> and sign in with the seeded admin:

```
username: admin
password: admin123
```

Override the seed credentials with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`
in `.env`. PWA icons ship in `public/icons/`; run `npm run icons` only to
regenerate them after editing the SVG source.

## Configuration (`.env`)

All values are optional except `GEMINI_API_KEY` for receipt OCR. See
`.env.example` for the full list.

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `3000`) |
| `SESSION_SECRET` | Signs session cookies — **change in production** |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | Admin seeded on first run |
| `GEMINI_API_KEY` | Enables receipt OCR (Gemini). Without it, uploads still attach but fields aren't auto-filled. |
| `GEMINI_MODEL` | Vision model (default `gemini-2.5-flash`) |
| `GOOGLE_MAPS_API_KEY` | Enables mileage address autocomplete + driving distance + route map receipts (Google). Enable **Places API (New)**, **Routes API**, and **Maps Static API** on the project. The key stays server-side. Without it, mileage entry is manual (typed stops + distance). |
| `APP_BASE_URL` | Public URL used to build password-reset links |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Email for password-reset links; if unset, links are shown to the admin to copy |
| `DB_PATH` / `RECEIPTS_DIR` | Where the SQLite db + receipt images live (default `data/…`) |

### Receipt OCR (Gemini)

Get a free key at <https://aistudio.google.com/apikey> and put it in `.env`:

```
GEMINI_API_KEY=your_key_here
```

Gemini reads PDF receipts natively (most accurate); images are normalized to
compact JPEG. PDF receipts are rasterized to PNG for previews and report
embedding via `pdftoppm` (poppler) — see [Prerequisites](#prerequisites); PDFs
still OCR and download without it.

### Mileage expenses

Pick the **Mileage** category (or the `🚗 Mileage` shortcut) and a route builder
appears in the expense form: add stops with address autocomplete, hit
**Calculate distance**, and the app fills the distance and computes
`amount = distance × rate`. It also renders the route as a map image and
attaches it as the receipt, so mileage claims get their own page — map, route,
distance, and rate — in the exported report PDF.

The default rate and distance unit (mi/km) are set per-install at
**Admin → Settings**; each expense stores the rate it used, so changing the
rate later never rewrites history.

With `GOOGLE_MAPS_API_KEY` unset, the route builder still works in manual
mode: type the stops and the distance, and the amount is computed the same
way — you just don't get autocomplete, the calculated distance, or the map.

#### Getting a Google Maps API key

The key is only ever used **server-side** — it is never sent to the browser.

1. **Create (or pick) a Google Cloud project** at
   <https://console.cloud.google.com/> — one project can serve this app alone.
2. **Enable billing** on the project (*Billing → Link a billing account*).
   Required even for the free tier — a credit/debit card is needed, but
   personal-scale use stays within the free monthly allotment and is not
   charged. Each of the three APIs below has roughly 10,000 free
   requests/month; one mileage expense uses ~3 requests.
3. **Enable the three APIs** the app uses (*APIs & Services → Library*, or
   these direct links — click **Enable** on each):
   - [Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com) — address autocomplete
   - [Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com) — driving distance + route map
   - [Maps Static API](https://console.cloud.google.com/apis/library/static-maps.googleapis.com) — the map "receipt" image
4. **Create a key**: *APIs & Services → Credentials → Create credentials →
   API key*. Copy it into `.env`:
   ```
   GOOGLE_MAPS_API_KEY=AIza…your_key_here
   ```
   then restart the app (the startup banner confirms: no
   `[Mileage distance disabled]` line means it's live).
5. **Restrict the key** (recommended, on the same Credentials page):
   *API restrictions* → *Restrict key* → tick only the three APIs above, so a
   leaked key can't be used for other Google services. *Application
   restrictions* → **IP address** if the server has a static IP; otherwise
   leave as *None* (the API restrictions still apply).

Verify it works:

```bash
GOOGLE_MAPS_API_KEY=… node bin/mileage-distance.js "Home" "Office"
```

which should print JSON with a `distance`. Common setup errors surface as
readable messages in the app's route builder: `REQUEST_DENIED` / "API not
enabled" means one of the three APIs (or billing) isn't set up on that
project.

> **Gotcha:** Google lists **Places API** (legacy) and **Places API (New)** as
> two separate APIs. If distance and the map work but address autocomplete
> fails, the key's API restrictions (or the enabled-APIs list) almost
> certainly have the legacy one ticked instead of **Places API (New)** —
> tick both, or only (New).

### User accounts & password resets

Admins create users with a first/last name, email, username, and password
(Admin → Users), and can **send a password-reset link** to a user's email.
Configure SMTP (table above) to email the link; otherwise it's shown to the
admin to copy. The reset page (`/reset-password?token=…`) is reachable **only**
via that link — there is no "forgot password" on the login page. Tokens are
hashed in the DB, expire after 24h, and are single-use.

## Usage

- **Dashboard** — unsubmitted/unfiled totals, recent expenses, category breakdown.
- **Scan** — upload a receipt; Gemini pre-fills the fields for you to review.
- **Expenses** — list, filter, add manually, edit, delete, crop receipts, attach to a report.
- **Mileage** — `🚗 Mileage` → route builder → driving distance + map receipt.
- **Reports** — create, attach expenses (Add / Scan buttons), set status, **Download PDF**.
- **Admin** — manage users and categories (admins only).

## Unix philosophy

The app is built from small tools that each do one thing and compose via the
filesystem / stdout — usable from the shell or the web layer:

| Tool | Does one thing |
|------|----------------|
| `bin/ocr-receipt.js <file>` | receipt (image/PDF) → expense JSON on stdout (Gemini) |
| `bin/mileage-distance.js "A" "B" [--unit km]` | route stops → driving distance JSON (Google) |
| `bin/make-report-pdf.js <id> [--out f]` | report → PDF file |
| `bin/create-user.js <name> [--password p] [--admin]` | create / reset a login |
| `bin/generate-icons.js` | render PWA icons |

Examples:

```bash
GEMINI_API_KEY=… node bin/ocr-receipt.js ./receipt.pdf | jq .merchant
GOOGLE_MAPS_API_KEY=… node bin/mileage-distance.js "Home" "Office" | jq .distance
node bin/create-user.js alice --admin          # prompts for password
node bin/make-report-pdf.js 3 --out q3.pdf
```

The Express app is the **composition layer** over `src/lib/*` + `src/routes/*`.
Storage is one SQLite file plus receipt images on disk — everything is a file.

## Architecture

```
bin/            standalone CLI tools (usable outside the web app)
src/lib/        config, db, queries, settings, maps, ocr, pdf, receipts, urls,
                auth, passwords, mail, categories, format
src/middleware/ auth guards (requireAuth / requireAdmin), flash messages
src/routes/     auth, dashboard, expenses, receipts, reports, admin
views/          EJS templates (server-rendered)
public/         CSS, JS, vendored client libs (cropperjs), manifest, service worker, icons  (PWA)
data/           SQLite db + receipt images (runtime, gitignored)
```

Tech: Node.js, Express, better-sqlite3, EJS, @google/generative-ai, pdfkit,
sharp, multer, nodemailer. No build step, no client framework, no SPA.

## Data, backup & reset

All state lives under `data/`:

- `data/app.db` — the SQLite database (users, expenses, reports, categories, reset tokens)
- `data/receipts/<userId>/YYYY/MM/…` — receipt images/PDFs + rasterized previews

**Backup:** copy `data/` (ideally with the server stopped). **Reset to a blank
slate:** delete `data/app.db` (and `data/receipts/*`) — the next `npm start`
re-creates the schema and re-seeds the admin.

## Security notes

Intended as a personal / self-hosted app. Before exposing it publicly:

- **Change `SESSION_SECRET`** and the seeded admin password.
- Passwords are bcrypt-hashed; sessions are HTTP-only, same-site cookies.
- Receipts are stored under `data/receipts/<userId>/…` and the file-serving route
  enforces ownership — a request is only served if the path resolves inside the
  requesting user's shard, so one account can't read another's receipts and
  path-traversal is rejected.
- Expenses and reports are scoped per user everywhere (cross-user access returns 404).

## License

MIT
