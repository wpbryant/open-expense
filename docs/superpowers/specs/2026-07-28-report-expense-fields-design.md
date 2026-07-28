# Report & Expense Fields + PDF Summary Rework

- **Date:** 2026-07-28
- **Status:** Design — pending implementation plan
- **Branch target:** `main`

## Goal

Bring more structure to expense report submission by adding three free-text
fields, and rework the PDF report's expense summary table into a 4-column layout
whose "Description" column carries a combined narrative string.

## Scope

**In scope**

- Three new free-text DB columns + idempotent migrations.
- Report form (standalone create/edit **and** the inline "Edit report" card):
  **Project Name**, **Product in Focus**.
- Expense form: **Chargeable To**.
- Report detail page: read-only **Project / Product in Focus** header line, and a
  **Chargeable To** column in the "Expenses in this report" table.
- PDF summary table: 4 columns, combined **Description** column, slightly smaller
  font.

**Out of scope**

- PDF header (`drawHeader`) — unchanged. Project Name / Product in Focus reach the
  PDF via the combined Description rows, not the header.
- Per-expense receipt page (`drawExpensePage`) — unchanged.
- Main expenses list page (`views/expenses/index.ejs`) — no new column.

## Data model

Follow the existing `ensureColumn()` migration pattern: add each column to its
`CREATE TABLE` block **and** to an `ensureColumn()` call in `migrate()` so existing
`data/app.db` files upgrade in place with empty defaults (no reset, no data loss).

| Table | New column | Definition |
|---|---|---|
| `reports` | `project_name` | `TEXT NOT NULL DEFAULT ''` |
| `reports` | `product_in_focus` | `TEXT NOT NULL DEFAULT ''` |
| `expenses` | `chargeable_to` | `TEXT NOT NULL DEFAULT ''` |

No query changes are required — every read uses `SELECT *` / `r.*`
(`src/lib/queries.js`), so the new columns surface automatically.

## In-app changes

### Report fields — Project Name, Product in Focus

- **`views/reports/form.ejs`** (standalone New/Edit report): two new text inputs
  grouped directly under *Report name*, in this order:
  1. Report name * (existing)
  2. **Project Name** (new)
  3. **Product in Focus** (new)
  4. Business purpose … (existing, rest unchanged)
- **`views/reports/detail.ejs`** inline "Edit report" card: same two fields added.
- **`src/routes/reports.js`**:
  - `POST /reports` (insert) and `POST /reports/:id` (update) read and persist both
    fields (trimmed).
  - `GET /reports/new` seeds `{ project_name: "", product_in_focus: "" }` alongside
    the existing empty defaults.

### Expense field — Chargeable To

- **`views/expenses/form.ejs`**: added as a third field in the classification row,
  producing a 3-column row (Category · Payment method · **Chargeable To**) using the
  existing `row-3` layout.
- **`src/routes/expenses.js`**:
  - `parseExpense()` adds `chargeable_to` (trimmed).
  - Create `INSERT` and update `UPDATE` persist it.
  - `GET /expenses/new` seeds `chargeable_to: ""`.

### Report detail display

- **`views/reports/detail.ejs`** header `.sub` line: append read-only Project /
  Product in Focus segments, shown only when non-empty, e.g.
  `· Project: Q3 Roadshow · Product: Widget X`.
- **`views/reports/detail.ejs`** "Expenses in this report" table: add a **Chargeable
  To** column immediately after *Category* (render `—` when blank). Bump the footer
  total-label `colspan` from `4` → `5`.

All three fields are **optional**; blank stays blank (no validation enforcement).

## PDF summary table — `src/lib/pdf.js` (`drawSummaryTable`)

Columns go from 5 → **4**. Total table width stays 512 (LETTER 612 − 2×50 margin).

| # | Header | Content | Width |
|---|---|---|---|
| 1 | Date | expense date, ISO `YYYY-MM-DD` *(unchanged)* | 60 |
| 2 | Merchant | merchant *(unchanged)* | 90 |
| 3 | Description | **combined string** (below) | 290 |
| 4 | Amount | amount, right-aligned *(unchanged)* | 72 |

**Font:** reduce all summary-table text (column-header band, body rows, and total
row) from **9pt → 8pt** so the long combined Description fits cleanly. Other PDF
sections (report header, receipt page) keep their current sizes.

### Combined Description (Column 3)

Build one string per expense by joining the **non-empty** components below in this
exact order, separated by `", "` (comma + space). Skip any blank component so there
are no `, ,` artifacts.

1. Report owner's **first + last name** (e.g. `William Bryant`; fall back to
   `username` if both are empty — same rule the header uses for "Prepared by").
2. Expense **category**.
3. Report **business purpose** (`report.purpose`).
4. Report **project name** (`report.project_name`).
5. Expense **date** as `D` + full month name + `YYYY` → `13July2026` (day unpadded,
   full month name, no separators). Parse the ISO date manually (split on `-`,
   index a month-name array) to avoid timezone drift — `new Date("YYYY-MM-DD")` is
   UTC and can shift the day in some timezones.
6. Report **product in focus** (`report.product_in_focus`).
7. Literal `Chargeable To ` + expense's `chargeable_to` → `Chargeable To Acme Corp`
   (omit entirely when `chargeable_to` is blank).
8. Expense's own **description** text (`e.description`) — appended last.

> Example row:
> `William Bryant, Meals, Client meeting, Q3 Roadshow, 13July2026, Widget X, Chargeable To Acme Corp, Dinner with prospect`

Implementation notes:

- Components 1, 3, 4, 6 are constant across every row in a report — compute them
  once before the table loop.
- The expense's own date (component 5) and category/description/chargeable_to vary
  per row.
- The date appears twice on purpose: Column 1 keeps the ISO date; the combined
  Description also embeds it in `13July2026` form. This is per the requested formula.
- Update the total-row width math for 4 columns: the total label spans
  `cols[0]+cols[1]+cols[2]` and the amount sits in `cols[3]`.
- Rows still wrap to multiple lines and paginate as today (the table already sizes
  each row by `heightOfString`); the longer combined string simply produces taller
  rows.

## Files touched

- `src/lib/db.js` — schema + migrations
- `src/routes/reports.js` — create/update handlers + `new` defaults
- `src/routes/expenses.js` — `parseExpense` + create/update handlers + `new` defaults
- `views/reports/form.ejs` — two report fields
- `views/reports/detail.ejs` — header line, inline edit fields, table column + colspan
- `views/expenses/form.ejs` — Chargeable To field
- `src/lib/pdf.js` — summary table columns, combined Description, 8pt font, total-row math

## Verification (manual)

1. Start the app against an **existing** `data/app.db` (pre-migration): confirm it
   boots, the three columns appear empty, and existing reports/expenses are intact.
2. Create/edit a report — set Project Name + Product in Focus; confirm persistence
   on reload and on the detail header line.
3. Create/edit an expense — set Chargeable To; confirm it shows in the report detail
   table.
4. Leave fields blank — confirm no errors, no `, ,` in PDF, header line hides empty
   segments.
5. Download a report PDF — confirm 4 columns, combined Description in the exact
   order above, 8pt font, correct total row, date token formatted `13July2026`.
6. Run `node bin/make-report-pdf.js <id> --out test.pdf` to verify the CLI path too.
