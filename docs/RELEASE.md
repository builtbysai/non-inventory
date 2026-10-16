Non-Inventory 2.1 — follow-up to the working 2.0.x release.

- Stop now exits the companion and survives browser reconnections.
- Status uses SQLite, removing heartbeat-file permission conflicts.
- Cleaner responsive station: scanning, found items, review and settings are separated.
- Scanner settings show only relevant controls; USB identification replaces guessing raw device paths.
- Missing-item repeats display Already found and refresh last-seen without increasing unique-found count.
- Reads the selected APEX site and blocks site changes instead of assuming SPA1.
- Optional monthly-record details panel with drafts, field-level conflict protection, backups and edit history.

Download **non-inventory-2.1.0.zip**. After the current audit, follow the upgrade instructions to preserve your existing workspace. Run SETUP.cmd and reload the temporary Firefox extension. No Mozilla signing is required for temporary use.

Windows/Linux automated checks include actual process stop/restart, native launcher installation, replay recovery, repeat recognition, concurrent detail edits, site-change refusal and simulated APEX responses. Physical-device behavior and authenticated live-page changes still need a short controlled check.
