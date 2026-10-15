# Non-Inventory

One barcode scan updates your missing-inventory CSVs and queues the SPA1 Oracle APEX audit. Windows + Firefox; local processing, no cloud or AI.

## Setup

1. [Download the ZIP](https://github.com/builtbysai/non-inventory/releases/latest), extract to a permanent local folder, and run **SETUP.cmd**. Setup installs Python and dependencies and registers the Firefox companion.
2. Put monthly investigation CSVs in `workspace\`. Required columns: `Serial Number`, `Asset ID`, `Status`, `Found By`, `Found Date`. Keep Excel closed. Optional product/serial reference: `audit-export-reference.csv`.
3. Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on** → `extension\manifest.json`. Open the extension → **Open station**.
4. Enter your login, choose scanner input, and **Save scanner settings**:

   | Mode | Use |
   | --- | --- |
   | COM — recommended | Background capture without typing into other apps. Set port/baud and Enter suffix. |
   | Windows HID | Select the scanner device, never your typing keyboard. Also types into the foreground app; keep the station focused. |
   | Focused field | Standard USB keyboard scanner. Keep the scan field focused; Enter suffix. |

5. Sign in to APEX, select **SPA1**, clear report filters and manual edits. Connect the official tab, then follow the [short live-test checklist](docs/LIVE-VERIFICATION.md).

## Scanning

- Capture tones mean saved locally; audit confirmation is separate. Slow/offline APEX does not stop device capture.
- **F8:** focus scan field. **F9:** pause/resume audit submissions; capture continues.
- **START.cmd:** start the companion after reboot. **STOP.cmd:** disable device capture.
- Finish with **Pending & exceptions**, then **Reconcile & complete**. Finalize the official audit separately.

Scans persist in `workspace\session.sqlite3`; original CSV backups are in `workspace\backups\`. Repeat scans refresh login/last-seen. Uncertain submissions are reconciled before any retry. Keep this folder private and retain the journal/backups. Use a separate application folder for each monthly audit.

## Firefox signing and validation

Normal Firefox requires **Mozilla signing** for permanent extension installation. [Unlisted signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) allows private distribution without a public store listing. Until signed, reload this temporary extension after each Firefox restart. The included XPI is unsigned.

Local Python and simulated APEX tests pass. Physical scanners and authenticated APEX still need live verification. See [troubleshooting](docs/TROUBLESHOOTING.md) and [technical details/tests](docs/DESIGN.md).
