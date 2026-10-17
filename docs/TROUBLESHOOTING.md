# Upgrade and troubleshooting

## Upgrade later, after your current session

1. Finish/reconcile pending submissions and close Firefox. Back up the **entire application folder**, including workspace.
2. Extract the new ZIP. Copy its source/setup files over the old application folder; keep the existing `workspace` intact. Never replace your journal or original CSVs with an empty folder.
3. Run **SETUP.cmd**. It stops only an older companion verified as belonging to that exact installation, then updates registration. Reload `extension\manifest.json` in Firefox. Existing scans, backups and settings remain.

The old 2.0.x **STOP.cmd** only disabled capture; it did not exit the process. Version 2.1 fixes that. A small native-message bridge may remain while Firefox is open so the station can display status and start the companion again.

| Symptom | Action |
| --- | --- |
| `companion-health.json` permission error | Upgrade and reload the extension. Status now uses SQLite; that file is no longer read or written. Do not change its permissions or delete your journal. |
| Scanning stopped | Click **Start scanning** or run **START.cmd**. Stop is persistent, including across browser reconnections. |
| No capture | Check saved login/mode. In scan-field mode use **F8**. Keep Windows awake and check recent receipts before rescanning. |
| USB devices confusing | Choose **Background USB → Identify my scanner**, then scan once without typing. The setup scan is not inventory. Raw paths are under connection details only. |
| COM reconnecting | Check Device Manager port, scanner mode and baud; close other port users. Use an Enter/CR/LF/Tab suffix. |
| CSV pending | Close Excel/sync editors. Check the row's error, required headers and available disk space. Pending work retries automatically. |
| Wrong site / audit paused | Verify the site's selection, sign-in, report filters and manual edits, then reconnect. A journal already bound to a different site needs a separate installation. |
| Unexpected APEX row | Review manually. Only verified new, unsaved scan-only rows can be removed automatically; persisted/legitimate inventory is never deleted automatically. |
| Details changed elsewhere | Your draft remains in the panel. Copy any text you need, then **Discard draft & reload** to discard the old draft and review current values. |
| Completion blocked | Wait for in-flight work and resolve exceptions against the official page. Reconcile again. |

Detail drafts autosave into the local journal. Wait for “Draft saved on this computer” before closing Firefox; use Resume details after reopening. Draft saving does not apply changes to CSVs. If a source row moved, the saved text remains available for copying. Saved field edits retain a backup and local change history. The form exposes existing Found/Investigation fields plus Notes, Location, Owner and Assigned To when present; it never creates columns.

Use the history search for a serial or scanned asset ID, and Previous/Next for older records. If the header says Barcode not focused, press F8. Scanner needs attention means the process is running but the chosen device/port is not ready.
