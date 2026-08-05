# Cash Forecast Grid

[![build](https://github.com/garethlist/cashGridProto/actions/workflows/build.yml/badge.svg)](https://github.com/garethlist/cashGridProto/actions/workflows/build.yml)

An interactive treasury cash-flow forecast built with **React + Vite** (no chart
or grid libraries — a custom SVG chart and an HTML table). **Daily** cashflow is
the source of truth: a granularity toggle (**Days / Weeks / Months**) re-buckets
the table, while the chart always plots the **daily running balance** — laid out
on the *same column geometry* as the table so the two read as one connected view.

## Features

### Entities, consolidation & currency
- **Company / currency tabs** — a top tab bar switches between entity grids
  (`UK · GBP`, `DK · DKK`, `US · USD`, `DE · EUR`), each with its own dataset and
  currency/locale (`src/currency.jsx`).
- **Distinct trading profiles** — each entity is seeded with a different shape so
  the balance curves read differently: a steady UK retailer, a fast-growing
  Nordic scale-up with an equipment-capex dip, a US turnaround dipping mid-year,
  and a lumpy project-billing German GmbH. Profiles (growth trend, seasonality,
  cost ratios, one-off items) live in `ENTITIES` in `App.jsx` and are applied by
  `makeInitialState` in `model.js`.
- **Live GROUP consolidation** — the `Σ GROUP` tab is a read-only consolidation
  of every entity (`consolidate()` in `model.js`); edits and shocks on any entity
  flow straight into the group view. A **"Show in" picker** re-denominates the
  whole group (grid, chart, metrics) into GBP / EUR / USD / DKK. A
  **contributions bar** shows each entity's share of the group closing balance.

### Grid modes
A **Mode** toggle (**Base** / **Shocks**) in the controls row changes how the
grid responds to clicks:

- **Base mode** (default) — click any aggregate cell to open a non-modal,
  docked **"browser"** side panel showing the data *underlying* that amount. The
  grid reflows beside the panel and stays live, so you can keep clicking cells
  (across a row, or between rows) and the panel updates in place.
  - **Customer Receipts** / **Suppliers** → **invoices grouped by
    counterparty**: the top 10 customers/suppliers (with share, a share bar, and
    expandable invoice lines) plus an "Other" bucket, reconciling exactly to the
    cell total.
  - **Every other row** → the **daily cash flows** that make up the bucket.
  - Built by `cellUnderlying` in `model.js`; rendered by `UnderlyingPanel`.
- **Shocks mode** — click a row (or the 🔍 icon) to **isolate that category's
  daily flow** in the chart; a per-cell **+** then adds a manual shock.

### Manual scenario shocks
- Add a **% or absolute** change, **one-off or ongoing**, over an editable date
  range, with a **reason**. Shocks **bake into the numbers** (table totals, net,
  closing balance, chart, KPIs) via `applyShocks` / `shockState` in `model.js`.
- **Source-tagged** — each shock records the grid it was entered on (a
  company/currency tab or the group). Entity shocks **roll up** into the GROUP
  consolidation; group-level shocks stay on the group. The side panel shows the
  source and can be **grouped by category or by grid**.
- **Active / inactive** toggle to include/exclude a shock from the forecast;
  **collapsible** single-row items with an inline-editable reason.
- **Chart markers** — active shocks appear as clickable spike markers in a lane
  above the plot (click → open + highlight in the panel); inactive ones grey out.
- **Diverge view** — an optional toggle splits the line into its **pre-shock
  "ghost"** (grey) and **shocked** (pink) paths, composing correctly with an
  active scenario.
- **KPI impact bridge** — affected KPI cards show a right-hand breakdown of the
  **Shock**, **Scenario** and combined **Total** impact.

### Scenarios & chart
- **Base + one optional scenario** — a *Compare* dropdown (laid out as a table)
  overlays at most one of three what-if scenarios: `UP10` *Uplift +10% from M3*,
  `VOL5` *Volatility ±5%*, `DN3` *Downside −3%/mo from M6* (`SCENARIOS` in
  `model.js`). An **emphasis switch** flips which line is prominent, and a
  per-series **± error band** toggle shows a placeholder uncertainty cone
  (`bandFraction`).
- **Chart detail** — daily area line, dashed zero line, alternating column
  bands, a marker at each bucket's closing day, and a hover tooltip (date, each
  line's value and band, net movement).

### View & UX
- **Days / Weeks / Months** toggle; the table aggregates, the chart stays daily.
- **Fit-to-window columns** — sized so a target count fills the width
  (**14 days / 13 weeks / 12 months**, `TARGET_COLS`), live on resize
  (`ResizeObserver`); extra buckets scroll horizontally.
- **Chart ↔ table alignment** — one shared horizontal-scroll container and
  identical column widths (pixel-accurate), with a sticky left gutter.
- **Scratchpad mode** — a full-screen chart + table takeover with a Close bar
  (Esc to exit) for a maximised working view.
- **Editable in Days view**; structural edits (add/remove/rename rows, opening
  balance) on entity tabs.
- **Headline metrics** from the daily series: opening, net over horizon, closing,
  lowest cash point (flagged when negative, caught at daily resolution).
- **Light / dark mode** — persisted, overrides OS preference; `data-theme` + CSS
  variables.

## Run it locally

Requires **Node 18+**.

```bash
npm install
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # production build to dist/
npm run bundle   # build + inline everything into a single self-contained artifact.html
```

## Reviewing the test data

None of the prototype's data is stored — it's generated on every load by
`makeInitialState` from the seed profiles in `src/views.js`, then overlaid with
the EUR sweep. To review it away from the app, run that generation once and write
it down:

```bash
npm run export-data
```

This produces `export/Cash Forecast Grid - test data.xlsx`, covering the seed
profiles, bank accounts, cash pools, every grid view, the source-type vocabulary,
the payment terms and invoice-survival curve, every daily cashflow, the bucket
aggregates at week and month granularity, the group consolidation in each display
currency, model metadata, the invoice-level drill-in detail, and the scenario
lines. A **Contents** tab indexes the rest and a **Checks** tab carries the
reconciliation assertions, so the numbers can be trusted before anyone reads
them. Tab and row counts track whatever the model currently generates — rerun the
command after changing `model.js` or `views.js`.

`scripts/export-data.mjs` imports the real model and emits a generic
`{name, note, columns, rows}` description per sheet;
`scripts/build-workbook.py` formats that into the workbook (needs
`pip install openpyxl`). All domain knowledge stays in the Node side, so the
export can't drift from the app. `export/` is git-ignored.

Two sheets carry a caveat, called out on the sheets themselves: the model
statistics (MAPE / Bias / Coverage) and the invoice-level allocations are seeded
from `row.id`, and `uid()` embeds `performance.now()` — so they're stable within
one page load but differ between loads. Cell totals, daily values and balances
are fully deterministic.

`npm run check-scopes` runs the standalone reconciliation check on its own.

`npm run bundle` runs the Vite build then `inline.mjs`, which folds the CSS and
JS into one standalone `artifact.html` (no external requests) — the file that
gets published as a hosted Claude Artifact. It's git-ignored (a build output)
and rebuilt on every push by the [`build`](.github/workflows/build.yml) GitHub
Actions workflow, which uploads it as a downloadable run artifact.

## Live demo

Every push to `main` deploys to **Azure Static Web Apps** — this is the link to
share:
<https://salmon-smoke-0d6197c10.7.azurestaticapps.net/>

Built and published by
[`azure-static-web-apps-salmon-smoke-0d6197c10`](.github/workflows/azure-static-web-apps-salmon-smoke-0d6197c10.yml),
which builds `dist/` on Node 20 and uploads it with `skip_app_build`. Pull
requests get their own preview environment from the same workflow.

The [`deploy-pages`](.github/workflows/deploy.yml) workflow also publishes to
**GitHub Pages** on the same trigger:
<https://garethlist.github.io/cashGridProto/>

(Pages needs enabling once — *Settings → Pages → Build and deployment → Source:
GitHub Actions* — and stays 404 while the repository is private.)

## Project structure

| File | Purpose |
| --- | --- |
| `src/model.js` | Daily data model, per-entity seed profiles, `computeDaily` / `bucketize` / `aggregate` / `consolidate`, `applyShocks` / `shockState`, `cellUnderlying`, `SCENARIOS`, date helpers |
| `src/App.jsx` | State, tabs, grid modes, shared column geometry, metrics, panel wiring |
| `src/currency.jsx` | `CurrencyProvider` / `useMoney` — per-tab currency & locale formatting |
| `src/components/AlignedChart.jsx` | Custom SVG daily-balance chart, shock-marker lane, diverge lines |
| `src/components/ForecastTable.jsx` | Aggregated table; editable in Days view; mode-aware row/cell interactions |
| `src/components/EditableCell.jsx` | Currency cell: formatted when idle, editable on click |
| `src/components/ShocksPanel.jsx` | Manual-shocks drawer (group by category/grid, collapsible items) |
| `src/components/UnderlyingPanel.jsx` | Base-mode underlying-data drawer (invoices / daily cash flows) |
| `src/components/ShockIcon.jsx`, `CategoryTag.jsx` | Shock spike icon; model-category tag |
| `src/index.css` | Styling, theme variables, alignment/sticky rules |
| `inline.mjs` | Inlines the Vite build into a single `artifact.html` |
| `scripts/export-data.mjs` | Builds every grid headlessly and dumps all test data as sheet descriptions |
| `scripts/build-workbook.py` | Formats that dump into `export/Cash Forecast Grid - test data.xlsx` |
| `scripts/check-scopes.mjs` | Reconciliation check: account and pool cuts add back to their company and to GROUP |

## How alignment works

`App.jsx` owns the geometry: a fixed `LABEL_W` (260px) left gutter plus a
per-granularity column width `colW` computed to fit the target column count into
the measured container. Total content width = `LABEL_W + nBuckets * colW`. Both
the chart `<svg>` and the `<table>` (with `table-layout: fixed` + a `<colgroup>`)
are set to that exact width and live in the same scroll container. The chart's
Y-axis gutter and the table's first column are both `position: sticky; left: 0;
width: LABEL_W`, so they stay locked together at every scroll offset. Each daily
point sits at
`LABEL_W + bucketIndex*colW + ((posInBucket + 0.5)/bucketDayCount)*colW`,
placing every day inside its bucket's column span.

## Calculation model

```
dailyNet[i]     = Σ inflows[i] − Σ outflows[i]        // after shocks are baked in
dailyClosing[i] = openingBalance + Σ dailyNet[0..i]   // chart line

// per table bucket b:
net[b]     = Σ dailyNet over the bucket's days
opening[b] = closing[b-1]  (openingBalance for b = 0)
closing[b] = opening[b] + net[b]                       // == dailyClosing at bucket end
```
