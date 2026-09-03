# Mileage Expenses: Route Builder, Google Distance, Map Receipt, Admin Settings

- **Date:** 2026-09-02
- **Status:** Design — approved, implementing
- **Branch target:** `main`

## Goal

Support the third real-world expense scenario: **mileage**. Today a user picks the
"Mileage" category and types a number into Amount — the route, the distance, and the
rate exist only in their head. This change lets the user build a route from addresses,
calculate driving distance like Expensify does (via Google), and produce a mileage
expense whose `amount = distance × rate` is transparent and auditable — with an
auto-generated **route map image attached as the receipt**, so mileage claims get a
full page in the exported report PDF like any other receipted expense.

Follows the app's optional-integration ethos: with `GOOGLE_MAPS_API_KEY` unset,
mileage entry still works in **manual mode** (typed stops + typed distance), exactly
as no `GEMINI_API_KEY` leaves manual entry working.

## Scope

**In scope**

- A `settings` table (the app's first) + admin UI for org-wide **default mileage rate**
  and **distance unit** (`mi`/`km`).
- Four new expense columns: distance, unit, rate, stops (JSON).
- A **Route fieldset** in the expense form, revealed when category is "Mileage":
  ordered stops with Google Places autocomplete, add/remove, "Calculate distance".
- Server-side Google proxy: Places Autocomplete (New), Routes v2 (`computeRoutes`),
  Maps Static. The key never reaches the browser.
- **Map receipt**: the route polyline + labeled stop markers rendered as a PNG
  (Static Maps) and attached through the existing receipt pipeline.
- Amount auto-fill (`distance × rate`), merchant auto-fill (`A → B → C`) — fill-if-blank
  only, never overriding deliberate values.
- PDF: mileage token in the combined Description + Distance/Route rows on the
  expense page; distance badge in list/report/dashboard views; `+ Mileage` shortcut.
- `bin/mileage-distance.js` CLI (Unix-philosophy tool, also the interop probe).

**Out of scope**

- Per-user rates or multi-currency rates — one org-wide default; the rate actually
  used is stored per expense (history stays correct when the admin changes it).
- Map view/leaflet UI in the browser — the only map is the generated static image.
- OSM/OSRM fallback routing.
- CSRF on the new JSON endpoints — matches the app's existing posture
  (sameSite=lax session cookies).

## Data model

Follow the existing `ensureColumn()` migration pattern (`src/lib/db.js`): add to the
`CREATE TABLE` block **and** to `migrate()` so existing `data/app.db` files upgrade
in place. All reads use `SELECT *`, so the new columns surface automatically.

| Table | New | Definition |
|---|---|---|
| `settings` | *(new table)* | `key TEXT PRIMARY KEY`, `value TEXT NOT NULL DEFAULT ''`, `updated_at` |
| `expenses` | `mileage_distance` | `REAL` — driving distance in `mileage_unit` units |
| `expenses` | `mileage_unit` | `TEXT NOT NULL DEFAULT ''` — `'mi'` \| `'km'` (frozen per expense) |
| `expenses` | `mileage_rate` | `REAL` — rate actually used, for audit |
| `expenses` | `mileage_stops` | `TEXT` — JSON array `[{name, placeId}]` (placeId optional) |

Seeded settings (INSERT OR IGNORE, so admin edits survive re-boots):
`mileage_rate = "0.76"` (Jul–Dec 2026 IRS business rate), `mileage_unit = "mi"`.

## Google APIs

One key (`GOOGLE_MAPS_API_KEY`), three APIs to enable on the GCP project — each an
Essentials-tier SKU with ~10k free requests/month:

1. **Places API (New)** — `POST /v1/places:autocomplete`, field mask
   `suggestions.placePrediction.placeId`, `.text.text`, `.structuredFormat.secondaryText.text`.
   Returns bare `ChIJ…` place ids (strip a defensive leading `places/`). A client-side
   UUID **session token** is sent per autocomplete session.
2. **Routes API** — `POST /v2:computeRoutes` (actually `…/directions/v2:computeRoutes`),
   waypoints written **directly** on `origin` / `destination` / `intermediates`
   (NOT nested under a `waypoint` key): `{"origin": {"placeId": "ChIJ…"}}`. Stops without
   a place id route as `{"address": …}`. Field mask `routes.distanceMeters`,
   `routes.polyline.encodedPolyline`. `routingPreference: "TRAFFIC_UNAWARE"`
   (deterministic distances, cheapest tier). Place ids from Places (New) interoperate
   with Routes per Google's Place IDs documentation — verified live via the CLI probe.
3. **Maps Static API** — GET with the key in the `X-Goog-Api-Key` header:
   `size=640x800&scale=2`, `path=enc:<encodedPolyline>`, one labeled marker per stop
   (`markers=label:A|place_id:…`, address fallback). Returns the map "receipt" PNG.

Distance converts meters → `mi` (/1609.344) or `km` (/1000). Stops clamped to 10
(Routes allows 25 intermediates; 10 bounds cost and UI size).

## In-app changes

### Settings — `src/lib/settings.js` (new)

`get/set` (per-process cache, invalidated on write) plus:
- `mileage()` → `{ rate, unit, autoDistance }` — rate NaN → 0.76, unit ∉ {mi,km} → 'mi',
  `autoDistance = maps.isConfigured()`.
- `fromMeters(meters, unit)`; `isMileage(category)` — the single gating helper:
  `String(category).trim().toLowerCase() === "mileage"` (categories are free text).

Read per request and passed into views as locals — **not** `app.locals` (boot-time
snapshot would go stale after an admin edit).

### Proxy — `src/routes/api.js` (new), mounted `app.use("/api", requireAuth, …)`

- `GET /api/places/autocomplete?q=&session=` →
  `{suggestions: [{placeId, label, secondary}]}` · 403 when key unset · 400 when `q` blank · 502 upstream.
- `POST /api/mileage/distance` `{stops: [{name, placeId}], unit}` →
  `{meters, distance, unit, map: {path, previewUrl, downloadUrl}}` — routes, renders the
  Static Map PNG, saves it via `receipts.save()` (base name `route-map`, so the stored
  file contains `route_map`) and returns receipt-style URLs. The client stages it into
  the hidden `receipt_path` input — the same idiom as `POST /receipts/upload`.
- Uniform `{error}` JSON, matching the crop/upload endpoints.

### Expense form — `views/expenses/form.ejs` + `public/js/app.js`

- A `<fieldset id="mileage-box">` after the amount row, `hidden` unless the category is
  mileage; `data-rate` / `data-unit` (the **effective** unit: the expense's own stored
  unit, else the current setting) / `data-auto` (`1` when autocomplete + Calculate are
  available). Stop rows: `name="stop[]"` text input + hidden `name="stop_place_id[]"`
  (repeated inputs fold into arrays under `extended:true` urlencoding) + remove button;
  `+ Add stop`; Distance / Rate inputs; Calculate button. Minimum two rows, labeled
  From / Via n / To. Progressive enhancement: with JS off, the rows still post and save.
- JS IIFE (no-ops unless `#mileage-box` exists): category toggle; debounced autocomplete
  per stop (session token via `crypto.randomUUID()`); add/remove/relabel; Calculate →
  distance endpoint → distance (1 dp) + amount (`round(distance × rate, 2)`) + merchant
  (`A → B`) fill + `showReceipt(map)`; re-Calculate replaces a generated map
  (`route_map` in the filename) but never a user-attached receipt. No-key mode: no
  dropdown/Calculate; free-text stops + manual distance still drive the client math and
  the server-side fill-if-blank.
- Server-side normalization runs **before** validation in both POST handlers:
  mileage → fill merchant from stops if blank, fill amount when 0/blank and distance > 0;
  non-mileage → clear the four mileage columns so stale data can't leak. Validation then
  requires distance > 0 and a valid unit for mileage expenses (light, matching the
  "fields optional" precedent).

### Admin settings — `src/routes/admin.js` + `views/admin/settings.ejs`

`GET/POST /admin/settings` (rate: `0 < n ≤ 100`; unit: `mi`|`km`) + a card modeled on
the categories page, linked from the admin panel's page-actions. Hints state that
changing the rate affects only new mileage expenses and show whether Google distance is
configured.

### PDF — `src/lib/pdf.js`

- `mileageToken(e)` → `42.3 mi @ $0.76/mi` inserted into `combinedDescription` right
  after the category.
- `drawExpensePage` gains `Distance` and `Route` (`A → B → C`) rows — meaningful for
  mileage claims, which normally have the map image as their receipt.

### Surfacing

Mileage badge (`🚗 41.1 mi`) in the expenses list merchant cell, report detail table,
and dashboard recent list; `+ Mileage` buttons next to the existing add/scan pairs
(plain links to `/expenses/new?category=Mileage[&report=<id>]`).

### CLI — `bin/mileage-distance.js`

`GOOGLE_MAPS_API_KEY=… node bin/mileage-distance.js "Home" "Office" [--unit km] [--place-ids id1 id2 …]`
→ JSON on stdout; doubles as the live check that Places (New) ids route correctly.

## Files touched

- `src/lib/config.js` — `googleMapsApiKey`
- `src/lib/db.js` — settings table, 4 expense columns, migrations, seeds
- `src/lib/settings.js`, `src/lib/maps.js` — new
- `src/routes/api.js` — new; mounted in `src/server.js` (+ `num1` local, startup hint)
- `src/routes/expenses.js` — parse/normalize/validate/INSERT/UPDATE/render locals
- `src/routes/receipts.js` — scan render passes the mileage locals
- `src/routes/admin.js` + `views/admin/settings.ejs` + `views/admin/index.ejs`
- `views/expenses/form.ejs`, `public/js/app.js`, `public/css/app.css`
- `src/lib/pdf.js`, `src/lib/format.js` (`num1`)
- `views/expenses/index.ejs`, `views/reports/detail.ejs`, `views/dashboard.ejs`
- `bin/mileage-distance.js` + `package.json` (bin entry, version 1.6.0)
- `public/sw.js` (cache bump), `.env.example`, `README.md`

## Verification (manual)

1. **Interop probe first**: with a real key, `bin/mileage-distance.js` routing place ids
   obtained from `places:autocomplete` — confirms Places (New) → Routes v2 compatibility
   before any UI is built.
2. **Migration**: boot against an existing `data/app.db` — the 4 columns exist (NULL/blank
   on old rows) and `settings` holds the two seeded values; nothing else changes.
3. **No key + JS on**: no autocomplete/Calculate; typed stops + distance → amount
   auto-fills; save → edit page round-trips stops, distance, rate.
4. **No key + JS off**: pick category Mileage manually, type distance, leave amount 0 →
   server fills `distance × rate` and merchant `A → B` (exercises normalize-before-validate).
5. **With key**: autocomplete picks per stop → Calculate → 1-dp distance, amount +
   merchant fill, **map appears in the receipt card**; save → map persists; attaching an
   ordinary receipt then re-Calculating does NOT clobber it; re-Calculating on a generated
   map DOES replace it.
6. **Failure paths**: unauthenticated `/api/…` → redirect; authed without key → 403
   `{error}`; one stop → 400; bad key → 502 with a readable message in `#mileage-error`.
7. **Validation**: Mileage with blank distance → 422 re-render, route fieldset still
   visible, typed values intact (they round-trip through `parseExpense`).
8. **Admin**: rate change persists; `/expenses/new?category=Mileage` shows the new rate;
   an old mileage expense keeps its stored rate; flipping the unit does not rewrite old
   expenses' units on edit.
9. **PDF**: report PDF shows `42.3 mi @ $0.76/mi` in the Description; the mileage page
   embeds the route map with Distance + Route rows. `bin/make-report-pdf.js` path too.
10. **Regression**: non-mileage saves unchanged; switching a mileage expense to Meals
    clears distance/rate/stops on save.
