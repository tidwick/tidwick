# Changelog

Notable changes, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form. The project follows [Semantic Versioning](https://semver.org/) from its first release.

## [0.1.0] - Unreleased

### Added

- Week grid: one sheet per person per week, with a note on each cell and keyboard entry.
- Weeks and approvals: submit a week, return or approve it, lock it, and see every state in the approvals list. An accounting admin can approve an open week for a person who has left, after a fresh step-up, and the audit log marks it.
- Reports: hours by person, client, project, task and week, with a chart drawn on the server.
- CSV: an export of approved entries per client, report downloads, and an import whose preview shows the hours and the date span before anything is written. Cells that start with a formula character are escaped.
- People: add, assign to projects, offboard and reinstate. Only admins and stewards create clients and projects.
- Sign-in: passkeys and optional single sign-on. Sensitive changes ask for a step-up (passkey or provider).
- Recovery: recovery codes, an admin re-enrolment link, and a first-admin claim at `/setup`.
- Backups: a nightly encrypted backup with an off-account copy, a restore drill, and a screen that re-wraps note keys.
- MCP agent surface, off unless the operator sets `MCP=on`: personal tokens, and sign-in for hosted clients (not yet checked against a live one). An agent acts as the person would.
- Limits the operator sets as deploy variables.
- Deploy to Cloudflare from the README button (untested on a real account).
- Audit log: an append-only, hash-chained record of every change.
- Note encryption: per-client keys for cell notes.
- Backup status: the nightly backup's health, and an alert when it fails.
- Demo: a picker of four invented people at `/demo`, reset every night.
