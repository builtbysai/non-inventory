# Troubleshooting

| Problem | Action |
| --- | --- |
| No capture / stale companion | Run **START.cmd**. Check saved login, capture checkbox and input mode. Focused-field mode needs **F8**. Check receipts before rescanning. |
| Wrong HID device | Compare device lists with scanner unplugged/replugged. Select its path and save. Never select your typing keyboard. Use COM to avoid foreground typing. |
| COM reconnecting | Check Device Manager port, scanner mode and baud. Close other port users. Configure CR/LF or Tab suffix; incomplete frames expire after two seconds. |
| Capture failure tone | Check disk space and folder permissions. Keep Windows awake. Only an acknowledged scan is safely journaled. |
| Native host unavailable | Rerun **SETUP.cmd** from the extracted permanent folder. Reload the temporary extension after Firefox restarts. Corporate policy may require IT approval. |
| CSV pending | Close Excel/sync editors. Check the displayed error and exact required headers. Remove unrelated CSVs from workspace. Processing retries automatically. |
| Audit paused / not in audit | Fix sign-in, SPA1 selection, report filters, dialogs or manual edits, then reconnect. Uncertain submissions are reconciled without blind retries. |
| Unexpected official row | Review it manually. Automatic cleanup handles only verified new, unsaved scan-only rows; persisted or legitimate inventory rows are never deleted automatically. |
| Completion blocked | Wait for in-flight work, resolve exceptions, then reconcile again. |
| Setup download fails | Check approved Internet/proxy access. Install Python 3.10+ manually if winget is unavailable. |

**STOP.cmd** disables capture; **UNINSTALL.cmd** unregisters native messaging without deleting inventory/history. The idle companion exits at logout/reboot.

Before moving/upgrading: stop capture, close Firefox, end that folder's `companion.py` process, copy the entire folder, then rerun setup. Never delete the journal to retry an uncertain audit.
