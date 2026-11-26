# Changelog

All notable changes are listed here, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form. The project follows [Semantic Versioning](https://semver.org/) from its first release.

## [0.1.0] - Unreleased

### Added

- Time entry grid: a weekly sheet per person, with a note on each cell and keyboard entry.
- Weeks and approvals: submit a week, return or approve it, lock it, and see every state in the approvals list. An accounting admin can approve an offboarded person's open week on their behalf, with a fresh passkey confirmation and a mark in the audit log.
- Reports and a chart: hours by person, client, project, task and week, with a server-rendered chart.
- CSV: export of approved entries per client, report downloads, and an import with a preview that shows the hours and the date span before anything is written. Cells that start with a formula character are escaped.
- People lifecycle: add, assign to projects, offboard and reinstate. Only admins and stewards create clients and projects.
- Sign-in: passkeys and optional single sign-on, with step-up confirmation for sensitive changes.
- Recovery and rescue: recovery codes, an admin re-enrolment link, and a first-admin claim at `/setup`.
- Backups: nightly encrypted backups with an off-account copy, a restore drill, and a key re-wrap screen for note keys.
- MCP agent surface, off unless the operator sets `MCP=on`: personal tokens and sign-in for hosted clients, acting as the person would.
- Operator-configurable limits, set as deploy variables.
- Deploy to Cloudflare from the README button.
