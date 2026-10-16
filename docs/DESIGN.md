# Design notes

## Data and recovery

Python commits raw receipts to SQLite (WAL, FULL synchronization) before CSV or website work. The companion projects receipts into all matching monthly CSVs using backups, fsynced temporary files and atomic replacement. A partial multi-file update replays the original timestamp. This is recovery across files, not a filesystem transaction; keep external editors closed while scanning.

The native host exposes only Firefox length-prefixed stdio. It stores no browser credentials and opens no network listener. Local status, stop requests and heartbeat now use SQLite, removing Windows sharing conflicts around the old JSON heartbeat. Stop persists `companion_enabled=false`, finishes the current CSV projection and exits the actual companion. Reconnecting Firefox does not restart it; Start explicitly does. The stdio bridge can stay available for controls.

Reference caches match exact serials/asset IDs first, then explicitly framed or punctuation-normalized values only when unique. No fuzzy guessing. Repeat scans update last-seen/login and retain first-seen; unique-found and repeat totals are separate.

## Audit scope and safety

The page contract remains `P4_SELECT_SERIAL`, `P4_SITE`, `P4_COUNTED_SERIAL`, and `CYCLE_COUNT`, with `SERIAL_NUMBER`, `SCANNED_ASSET_SERIAL`, `ASSET_TAG` and `STATUS`. The extension reads the selected site's label and value through the page/Oracle item API, binds the local journal to that site, and checks it before each submission. Different sites require separate workspaces. Filters and server permissions remain effective.

One persistent Firefox background worker owns submissions. `sending` is durable before any external write; reconnection reconciles instead of blindly retrying. Success requires the original matching row, a saved staged/audited/finalized status, and clean metadata. Model events wake verification with a fallback for hidden flags. Completion rereads confirmed receipts before a local snapshot; official audit finalization remains separate.

Automatic cleanup requires one new unsaved inserted scan-only row, exact submitted serial, no legitimate serial/asset identity, the original model, and exclusive change ownership. Persisted or ambiguous rows are never deleted automatically.

## Interaction changes

Scanning stays central; connection details move to Settings. Only the chosen input mode's controls appear. A deliberate USB identification step learns the device path without adding its barcode to inventory; labels show connection type and VID/PID without guessing a manufacturer. Raw paths are collapsed. Background keyboard scanners still emit foreground keystrokes; COM avoids that limitation.

Recent scans, unique missing items and exceptions have separate views. Repeat scans say Already found. An optional non-modal details panel uses each CSV's actual existing fields, with system identity/timestamps read-only. Editable fields include Found/Investigation fields and Notes, Location, Owner, Assigned To when present. Drafts remain in memory through view changes. Field-level optimistic checks allow live timestamp/other-row changes while refusing conflicting detail edits. Each explicit save backs up the file and records the changed fields/login locally. Drafts are not durable until saved.

Layout uses system typography, restrained color, text status labels, visible focus rings, responsive controls and horizontally scrollable records at narrow widths. It does not load external fonts, analytics or UI frameworks.

## Research

- [Microsoft Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/raw-input): device-specific identification and input notifications.
- [Oracle APEX item API](https://docs.oracle.com/en/database/oracle/apex/24.1/aexjs/item.html): selected value and display-label access.
- [GOV.UK radios](https://design-system.service.gov.uk/components/radios/): reveal only controls relevant to the selected answer.
- [GOV.UK error messages](https://design-system.service.gov.uk/components/error-message/): actionable messages beside the relevant controls rather than a misleading global outage banner.

The connected-browser tools were unavailable during this update, so no live page inspection is claimed. The user's reported successful 2.0.1 workflow is valuable live feedback; new changes still require a controlled check on the actual scanner/page.

## Validation

```text
python -m unittest discover -s tests -v
node tests/test_apex_mock.js
node tests/test_coordinator.js
node tests/test_station_core.js
python tools/package.py
```

CI runs Windows/Linux checks, actual Windows PowerShell 5.1 installation and native-launcher communication, device enumeration and Raw Input registration. Synthetic tests cover actual companion exit, persistent stop, inaccessible legacy heartbeat paths, journal replay, aliases/repeats, conflict-safe details, site-change refusal and deletion safety. Static station checks verify controls/labels and script ordering. Browser rendering and physical-device testing remain separate acceptance checks.
