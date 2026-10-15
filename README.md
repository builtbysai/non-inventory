# Non Inventory · SPA1

One handheld barcode scan, two workflows: local missing-item CSV investigation and the authenticated Oracle APEX monthly field IT hub audit. **Windows + Firefox, no cloud, no AI, no paid dependencies.** Workstation admin permissions are not required to register the native helper.

> **Live-company-system integration not yet verified.** The browser connector was built from a supplied October 15, 2026 saved APEX page (`P4_SELECT_SERIAL`, `P4_SITE`, `CYCLE_COUNT`) and must be proven on a controlled scan before a full audit. Do not interpret an unconfirmed attempt as audited.

## Tonight: fastest setup

1. Download and **extract the entire local ZIP** into a permanent folder, for example `C:\Tools\non-inventory`. Do not run files from inside a ZIP, OneDrive temporary location, or network share.
2. Double-click **`SETUP.cmd`**. It finds Python 3, optionally offers a `winget` install if needed, validates CSV headers, registers Firefox native messaging under your Windows account, and opens Firefox setup instructions.
3. Open Firefox's `about:debugging` → **This Firefox** → **Load Temporary Add-on** → select **`extension\manifest.json`**. **Firefox requires Mozilla signing for a permanent extension; the unsigned development extension must be reloaded after Firefox restarts.** This is a Firefox restriction, not an application failure.
4. Open the official **Field IT Audit Count** tab, sign in normally, select **SPA1**, and dismiss any popups. From the Non Inventory extension icon, click **Open station**. Enter your company technician login, choose the official tab, then **Connect official audit** (approve site access).
5. Confirm it reports all **427 October audit rows** (or the current live count), with an adequate serial index. Scan **one already-staged serial** and **one known not-audited serial** before starting the cage. Check the official website's staged/not-audited counters manually.
6. Put focus in the large scan field, point the **handheld USB barcode scanner**, press its trigger, and let it append **Enter**. **F8** refocuses; **F9** pauses/resumes. Keep the scan station open and the laptop awake. Audio confirms capture and audit completion separately.
7. When finished, review **Pending & exceptions** until nothing remains to investigate, then take the updated investigation CSVs from **`workspace\`**. Keep the SQLite journal and backups for recovery.

**Do not close Firefox while scans are still queued.** If you do, scans remain in the local journal. On reconnect, interrupted submissions are checked read-only against the official grid before they can be considered complete.

## Expected results

| Barcode | Missing-list CSV | Official site |
| --- | --- | --- |
| Found in July/August/September | Sets `Status=found`, `Found By=login`, and refreshes `Found Date` | Checks current SPA1 serial index; stages only a unique `Not Audited` match |
| Missing serial scanned a second time | Refreshes `Found Date`; first time retained in SQLite journal | Already-staged is acknowledged, never resubmitted |
| Item/product number | Rejected using reference export unless exact investigation match | Never sent |
| Unknown serial / packaging code | Logged as capture, not a found investigation item | Skipped unless a unique official serial match exists |
| Ambiguous / unexpected APEX response | CSV change remains saved | Pauses, preserves receipt for manual review; does not delete arbitrary records |

## Files and privacy

- **`extension/`**: Firefox MV3 extension and APEX connector. Access permission is granted only to the chosen inventory website's origin.
- **`app/`**: Python standard-library native messaging bridge and original-CSV updater. No network port or server.
- **`workspace/`**: Put original `investigation-items <month> SPA1.csv` documents and optional `audit-export-reference.csv` here. The **personal GitHub repository excludes this directory's contents**. The local download ZIP may include the supplied CSVs, so keep it on your company-approved machine.
- **`workspace/session.sqlite3`**: durable scan receipts, pending audit state, first-found timestamps, exceptions.
- **`workspace/backups/`**: timestamped pre-write copies of CSVs. The 41-column source layout and all untouched fields are preserved. Location and notes are editable afterward in the station.
- **`SETUP.cmd`** registers only `HKCU\Software\Mozilla\NativeMessagingHosts\non_inventory_host` and saves a tiny local launcher; **`UNINSTALL.cmd`** unregisters the host without erasing data.

## Safety and known limits

- The downloaded October inventory report has **427 rows but no serials**; it is useful only for rejecting known item-number barcodes. The authenticated Oracle APEX Interactive Grid is the source for serial-to-audit lookup. If expected rows are absent, **unknown serials are not sent**, even if they might be legitimate inventory. Such mismatches need manual investigation.
- The extension submits through the APEX page's own scan input/Enter dynamic action; never sends unauthorized HTTP calls, steals cookies, or bypasses sign-in. Success means the matching APEX grid row was checked and marked staged. A server timeout is **not** considered success.
- To avoid accidentally deleting legitimate inventory, this version **does not automatically delete official rows**. It prefilters unmatched serials before they are submitted; unexpected results pause for manual review.
- The current browser session must remain signed in, correctly scoped to SPA1, and allowed to automate official auditing under your workplace's policies.
- A standard USB keyboard-emulation handheld scanner works without extra software; set the scanner's suffix to Enter. If your scanner is configured as a COM port instead, switch it to USB HID keyboard mode using its vendor programming guide.
- Firefox temporary extensions disappear after restarting the browser. For long-term use, have the extension signed through Mozilla's official distribution process. See [Mozilla's documentation](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox).

## Development checks

```bash
python -m unittest discover -s tests -v
python tests/preflight.py
node --check extension/background.js
node --check extension/station.js
```

Troubleshooting: If the native host is unavailable, re-run `SETUP.cmd`, ensure Python 3 is installed, and reload the extension. If the audit fails to connect, refresh the live APEX tab, select SPA1, and reconnect. If the serial index is incomplete, clear Interactive Grid report filters and reconnect rather than issuing blind submissions.
