---
type: changelog
status: active
Last-updated: 2026-06-14
version: leg/jug-csv-import @ 2026-06-14
---

# Changelog

All notable changes to juggler-backend are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

- **CSV export** (`GET /api/data/export?format=csv`, ROADMAP 999.254): the export endpoint now accepts an optional `format=csv` query parameter. The response is `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="juggler-tasks.csv"`. The body is the authenticated user's tasks as RFC-4180 CSV (18 fixed columns; array fields joined with `;`; `\r\n` line endings). The default behaviour (`format=json` or no parameter) is unchanged — the v7 JSON backup envelope is returned exactly as before. The CSV path reuses the same `authenticateJWT` + `requireFeature('data.export')` gate and `userId`-scoped data fetch as the JSON path; no new route or data source is added.

- **CSV import** (`POST /api/data/import` with `Content-Type: text/csv` or `?format=csv`, ROADMAP 999.255): the import endpoint now accepts an RFC-4180 CSV body in the same 18-column format produced by the CSV export. Import is always **additive (merge mode)** — mode is hard-forced to `merge` in the controller; existing tasks and configuration are never wiped. Imported rows are inserted as new tasks with freshly fabricated ids (no collision). Malformed CSV (unbalanced quotes, ragged row, missing `text` header column) returns `400` with `{ "error": "Invalid CSV: … " }` and zero DB writes. No feature gate — available on all plans. 2 MB body cap (shared with the JSON path). **Known limitation:** a `location` or `tools` name containing `;` is not round-trip-safe (the `;` is the array separator). See `docs/api/README.md` §"POST /api/data/import — CSV path" for full reference.
