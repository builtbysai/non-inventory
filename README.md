# Non-Inventory

Continuous barcode scanning for missing-inventory investigation and your Oracle APEX audit. Windows + Firefox. Local files, no cloud or AI.

## Install

1. [Download the latest ZIP](https://github.com/builtbysai/non-inventory/releases/latest), extract it to a permanent local folder, and run **SETUP.cmd**.
2. Put monthly investigation CSVs in `workspace\`. Required columns: `Serial Number`, `Asset ID`, `Status`, `Found By`, `Found Date`. Keep Excel closed. Optional product/serial reference: `audit-export-reference.csv`.
3. Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on** → `extension\manifest.json`. Open the extension → **Open station**. Reload it after Firefox restarts; no signing needed for temporary use.
4. In **Settings**, save your login and scanner mode. Only relevant controls appear:
   - **This scan field:** ordinary USB keyboard scanner; keep Barcode focused, with Enter suffix.
   - **Background USB:** click **Identify my scanner**, then scan once. Save the identified device. Keyboard-mode scanners still type into the foreground app.
   - **Serial port (COM):** set port/baud. Captures in the background without typing into other apps.
5. Open the official audit, select the intended site, then **Connect selected audit** in Settings. The site is read from the page and shown in the header. A changed site blocks submissions. Use a separate installation for another site.

## Daily use

**Start scanning** starts the companion. **Stop scanning** or **STOP.cmd** exits it and retains the queue; it stays stopped until explicitly started. **F9** pauses only website submissions. **F8** returns focus to Barcode. Start after reboot with **START.cmd**.

**Missing found** shows unique items. Repeats say **Already found**, refresh last-seen/login, and count separately. Click **Add details** for a side form with the actual monthly record's investigation fields. Drafts stay in memory while you scan; edits merge around timestamp updates and detect conflicting field changes. Original inventory fields remain read-only. COM allows scanning while editing; keyboard scanners require returning focus with F8 or editing between batches.

Use **Review** for exceptions, then **Reconcile & finish**. Finalize the official audit separately. Journal and backups remain in `workspace\`; keep the entire folder private.

[Upgrade and troubleshooting](docs/TROUBLESHOOTING.md) · [Live-test checklist](docs/LIVE-VERIFICATION.md) · [Technical notes](docs/DESIGN.md)
