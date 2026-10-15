# Non-Inventory

Windows-first barcode scanning for SPA1 missing-inventory investigation and the authenticated Oracle APEX monthly audit. Python companion + Firefox extension. Local files, no application server, cloud, camera, AI, or paid services.

**Live APEX integration and physical scanners have not been verified in this build.** The connector uses the existing repository's page contract: `P4_SELECT_SERIAL`, `P4_SITE`, `P4_COUNTED_SERIAL`, and `CYCLE_COUNT`. It refuses uncertain writes and requires a confirmed, saved matching grid row before reporting success. See [live verification](docs/LIVE-VERIFICATION.md) before your first cage walk.

## Install on Windows

1. Download [the release ZIP](https://github.com/builtbysai/non-inventory/releases/latest), extract everything to a permanent local folder such as `C:\Tools\Non-Inventory`.
2. Double-click **SETUP.cmd**. Or run `.\SETUP.cmd` in a terminal. It installs Python 3.13 if needed using winget, creates an isolated environment, installs the COM driver library, checks your CSVs, registers Firefox native messaging under your Windows account, and creates a desktop launcher. No admin rights normally needed. Internet is needed only for initial dependency installation.
3. Copy **all original monthly investigation CSVs** into `workspace\`. No renaming required. Each needs `Serial Number`, `Asset ID`, `Status`, `Found By`, `Found Date`. Additional fields remain intact. Optional `audit-export-reference.csv` can contain `Item Number(LOV)` for product-code rejection and `Serial Number` / `Asset ID` for reference matching. Keep CSVs closed in Excel during scanning.
4. Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on** → choose `extension\manifest.json`. Click its toolbar icon → **Open station**. Temporary installation must be repeated after Firefox restarts. The included XPI is **unsigned**; permanent normal Firefox installation requires [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). No signing credentials are supplied, so this release does not pretend to be permanently installable.
5. Enter your technician login, choose a scanner mode, and click **Save scanner settings**:
   - **COM** (recommended): scanner configured as USB virtual serial, correct COM number and baud rate, CR/LF or Tab suffix. It captures outside Firefox focus without typing into another app.
   - **Windows HID**: select the scanner's exact device path (VID/PID). Compare the device list with it unplugged/replugged using **Refresh scanner devices**. Never select your typing keyboard. Captures without Firefox focus, but a keyboard-wedge scanner also types into the foreground application. Keep the station focused; use COM to avoid stray typing into APEX or another app.
   - **Focused scan field**: ordinary USB keyboard emulation, Enter suffix. Only captures with the scan field focused. **F8** refocuses it. Device modes disable duplicate field capture.
6. Sign in to the official APEX audit in a separate tab. Select SPA1, clear report filters, save/discard manual edits and dismiss dialogs. Select that tab in the station and **Connect official audit**. Approve access to that website only. Prove one already-audited and one known not-audited scan before continuous use.

Capture beeps mean **journaled locally**, not audited. The station separately shows captured, missing-found, audited, queued, and review results. Speech is optional. **F9 pauses audit submissions; device capture continues.** Disable the capture checkbox and save settings, or run `STOP.cmd`, to stop device capture.

## Daily operation and recovery

The companion runs independently of Firefox after setup or **START.cmd**. Device capture continues if Firefox closes, while Windows remains awake and the companion is running. After reboot, launch START.cmd; automatic startup is intentionally not installed. Opening the extension also starts the companion. Keep the station open for audit tones and detailed status.

Every scan is committed to `workspace\session.sqlite3` before any CSV or website operation. CSV processing and website latency do not gate input. Repeat scans refresh `Found By` and `Found Date` across all matching months, with first/last seen retained in the journal. Serial and asset aliases collapse to the same known serial. Ambiguous formatting matches change nothing and require review. Unknown identifiers never reach APEX unless the loaded full grid uniquely identifies them.

Backups live in `workspace\backups\`. CSV writes preserve column order, extra fields, supported encoding (UTF-8/BOM or Windows-1252), delimiter and line endings; original bytes remain in each pre-write backup. CSV quoting may be normalized. Files are replaced atomically. If Excel locks a file, captures remain journaled; close Excel and the companion retries. A crash between monthly files replays the same timestamped patches. Do not edit CSVs concurrently with scanning; external changes detected before replacement defer the write.

On website interruption, the journal retains `sending`. Reconnect the correct audit tab; the extension checks the matching row before proceeding and never blindly resubmits an uncertain write. Safe cleanup only removes a new **unsaved**, scan-only inserted row when its identity and exclusive change ownership are verified. Persisted rows, legitimate serial/asset rows, additional edits, and uncertain identities are never automatically deleted.

Finish with **Pending & exceptions**. Check exceptions against the official site and record a specific manual resolution. **Reconcile & complete** disables device capture, pauses submissions, rechecks previously confirmed serials against the current grid, and records a local completion snapshot only after all receipts are accounted for. This does **not** finalize the official Oracle audit or assert that every physical device was scanned. Finalize there after your normal review. Every new scan makes earlier completion snapshots historical.

For a new monthly audit, use a new extracted application folder and copy in the monthly reference/investigation CSVs. Keep the previous folder's journal and backups as an archive; never delete them to clear a queue. Do not point two application copies at the same files or scanner simultaneously.

## Help and development

See [troubleshooting](docs/TROUBLESHOOTING.md), [live verification](docs/LIVE-VERIFICATION.md), and [design and sources](docs/DESIGN.md).

```text
python -m unittest discover -s tests -v
node tests/test_apex_mock.js
node tests/test_coordinator.js
python tests/preflight.py
python tools/package.py
```

Only COM mode needs `pyserial==3.5`; all other companion code uses Python's standard library. Python 3.10+, Firefox 128+, Windows 10/11. Development checks run on Linux; CI also validates on Windows. Release packaging uses a source allowlist and never includes inventory files, the virtual environment, generated launchers, journals, credentials, or backups. All `workspace` contents except `.gitkeep` are Git-ignored. Store this folder on your approved encrypted company computer; it contains your inventory and login locally.
