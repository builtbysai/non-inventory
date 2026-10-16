# Before the cage walk

Local tests use synthetic CSVs and simulated APEX. No company exports, saved pages, authenticated session, or physical scanner were available for verification.

1. **CSV:** In investigation-only mode, scan a known serial and its asset ID. Check all matching months, login, timestamp and backups. Repeat a scan; last-seen should refresh without changing unrelated fields.
2. **Scanner:** Confirm input mode, device/port, keyboard layout and Enter suffix. Test unplug/reconnect and another app's focus. COM should not type there; HID will. Ordinary typing must not create scans. Device capture should survive closing Firefox.
3. **APEX:** Select the intended site, clear report filters/edits and connect. Compare indexed rows with the actual report. Scan one already-audited item and one not-audited item; verify the same existing row is saved and official counters agree.
4. **Rejection:** Scan a product code and unrelated barcode. Neither should create official rows. Ambiguous identifiers must require review. Persisted rows are never automatically deleted.
5. **Recovery:** Interrupt one controlled submission, reconnect and verify read-only reconciliation without resubmission. Try a short batch while the site is slow; captured scans should keep accumulating.
6. **Finish:** Resolve exceptions, then reconcile and complete. Confirm the official audit separately.

The adapter expects `P4_SELECT_SERIAL`, `P4_SITE`, `P4_COUNTED_SERIAL`, and `CYCLE_COUNT`. Saved statuses must be `Staged for Audit`, `Audited`, or `Finalized`; codes 2/3/4/7/8/9 trigger review. Different live behavior requires an adapter adjustment. Report loading respects existing server filters.

For 2.1, also verify Stop exits the companion, Start resumes it, USB identification picks the correct scanner, and the details panel preserves a draft while another scan updates last-seen. Confirm the header site matches the live page; changing it must block further submissions.
