# Cash Forecast Grid

An interactive cash-flow forecast built with **React + Vite**. **Daily** cashflow
is the source of truth: a granularity toggle (**Days / Weeks / Months**) re-buckets
the table, while a custom SVG chart always plots the **daily running balance** —
laid out on the *same column geometry* as the table so the two read as one
connected view.

## Features

- **View tabs (company / currency) + consolidation** — a top tab bar switches
  between entity grids (`UK · GBP`, `DK · DKK`, `US · USD`, `DE · EUR`), each with
  its own dataset and currency/locale (via `src/currency.jsx`). The **`Σ GROUP`**
  tab is a **live, read-only consolidation** of every entity — computed by
  `consolidate()` in `model.js`, so edits on any entity flow straight into the
  group view. A **"Show in" currency picker** re-denominates the whole group view
  (grid, chart, metrics, contributions) into GBP / EUR / USD / DKK; defaults to
  GBP. SUMMARY adds a **contributions bar**
  (each entity's share of the group closing balance, click to open) and a
  read-only badge; editing/add/remove are disabled there. Entities/rates live in
  `ENTITIES` in `App.jsx`.
- **Modelled vs manual categories** — every category shows a **⚡ bolt** when it is
  modelled (hover for the model + category tag) or a **👤 person + "Manual"** when
  entered by hand. Tax & VAT ships as Manual; the rest are modelled. Grid cells
  show plain grouped numbers (currency is conveyed by the tab); empty cells show
  an en-dash.


- **Days / Weeks / Months toggle** at the top of the page. The table aggregates
  daily data into the chosen bucket; the chart line stays daily.
- **Fit-to-window columns** — columns are sized so a target count fills the
  browser width by default: **14 days, 13 weeks, 12 months**. The page uses the
  full window and re-sizes columns live on resize (`ResizeObserver`); when a view
  has more buckets than fit (days, weeks) the rest scroll horizontally. Targets
  live in `TARGET_COLS` in `App.jsx`. Seed data spans a full 12 months
  (Jul 2026 – Jun 2027) so the Months view fills exactly.
- **Chart ↔ table alignment** — chart and table share one horizontal-scroll
  container and identical column widths, so each period's daily line sits
  directly above that period's table column (verified pixel-accurate). A sticky
  left gutter keeps the Y-axis and row labels pinned while columns scroll.
- **Category-level models + isolate** — each line-item (category) row carries a
  **model tag** (the model that would forecast it — categorised *Statistical* /
  *Custom R&D* / *ML/AI*), since modelling is done per category. Click a row's
  chart icon to **isolate that category's daily flow** in the top chart (inflows
  positive/green, outflows negative/red); *Back to balance* returns to the
  balance view. The **Compare dropdown works here too** — the same scenarios
  (Uplift / Volatility / Downside) and per-series error bands can be overlaid on
  the isolated category, with the category itself as the dropdown's base row.
  Category models live on each row in the seed data in `model.js`.
- **Manual scenario shocks** — while a category is isolated, a **Manual shocks**
  lane appears above the time columns. Click **+** on any period to add a shock —
  a `%` or absolute change, one-off or ongoing — with a **reason**. The chart
  overlays a dashed "shocked" line and a marker at the shock; the lane shows a
  removable chip (reason on hover). Shocks are held per category
  (`applyShocks` in `model.js`) and don't alter the underlying table figures.
- **Editable in Days view** — click any inflow/outflow cell to edit the daily
  figure; the running balance, chart and headline metrics update live. Weeks and
  Months show read-only aggregated totals (switch to Days to edit).
- **Structural edits** — add/remove line-item rows, rename rows inline, edit the
  opening balance.
- **Base + optional scenario** — the **Base** line (the main table numbers) is
  always drawn. A *Compare* dropdown overlays at most one scenario on top for
  comparison, or **None** for base alone. The dropdown is laid out as a table —
  one row per series with aligned columns: select · **Code** · **Scenario** ·
  **Description** · **Band**. Three dummy what-if scenarios ship: `UP10` *Uplift
  +10% from M3*, `VOL5` *Volatility ±5%*, and `DN3` *Downside −3%/mo from M6*.
  All defined in `SCENARIOS` in `model.js`. (Forecasting models are a
  category-level concept — see below — not attached to scenarios.) When a
  scenario is active the affected KPI cards show its value as a coloured
  subscript.
- **Emphasis switch** — when a scenario overlay is shown, the emphasised line
  gets the filled area, a bold stroke and the markers while the other recedes to
  a thin, faint line. It defaults to emphasising the **scenario** (base takes a
  backseat); a **Base ⇄ Scenario** switch flips which is prominent, and the
  area-fill colour follows the emphasised line. Works in balance and
  isolated-category views.
- **Per-series forecast error band** — the dropdown carries a `± band` toggle on
  each series (Base and every scenario), so you can show the band independently
  per line — e.g. Base as a clean reference with the band only on the overlay,
  or vice-versa. A line with its band off shows a plain line (Base keeps its
  area-to-zero fill). The band uses a placeholder uncertainty model
  (`bandFraction` in `model.js`) that fans out with the horizon (~±2% → ~±16%,
  sqrt shape); swap it for a real model later. The hover tooltip lists each
  line's value and, where its band is on, the ± range.
- **Chart detail** — daily area line, dashed zero reference line, alternating
  column bands, a marker at each bucket's closing day, and a hover tooltip
  showing date, baseline, active scenarios and that day's net movement.
- **Headline metrics** from the daily series: opening, net over horizon, closing,
  and the lowest cash point (flagged red if it goes negative — caught at daily
  resolution, not just month-ends).
- **Light / dark mode** — a sun/moon toggle in the tab bar switches theme; the
  choice is persisted (localStorage) and overrides the OS preference, while a
  first-time visitor defaults to their OS setting. Themes are driven by a
  `data-theme` attribute + CSS variables.

## Run

```bash
npm install
npm run dev      # Vite on http://localhost:5173
npm run build    # production build to dist/
```

## Structure

| File | Purpose |
| --- | --- |
| `src/model.js` | Daily data model + seed generator; `computeDaily`, `bucketize`, `aggregate`, date helpers |
| `src/App.jsx` | State, granularity toggle, shared column geometry, layout, metrics |
| `src/components/AlignedChart.jsx` | Custom SVG daily-balance chart aligned to the table columns |
| `src/components/ForecastTable.jsx` | Aggregated table; editable in Days view |
| `src/components/EditableCell.jsx` | Currency cell: formatted when idle, editable on click |
| `src/index.css` | Styling, theme variables, alignment/sticky rules |

## How alignment works

`App.jsx` owns the geometry: a fixed `LABEL_W` (220px) left gutter plus a
per-granularity `COL_W`. Total content width = `LABEL_W + nBuckets * COL_W`.
Both the chart `<svg>` and the `<table>` (with `table-layout: fixed` + a
`<colgroup>`) are set to that exact width and live in the same scroll container.
The chart's Y-axis gutter and the table's first column are both
`position: sticky; left: 0; width: LABEL_W`, so they stay locked together at
every scroll offset. Each daily point is placed at
`LABEL_W + bucketIndex*COL_W + ((posInBucket + 0.5)/bucketDayCount)*COL_W`,
putting every day inside its bucket's column span.

## Calculation model

```
dailyNet[i]     = Σ inflows[i] − Σ outflows[i]
dailyClosing[i] = openingBalance + Σ dailyNet[0..i]      // chart line

// per table bucket b:
net[b]     = Σ dailyNet over the bucket's days
opening[b] = closing[b-1]  (openingBalance for b = 0)
closing[b] = opening[b] + net[b]                          // == dailyClosing at bucket end
```
