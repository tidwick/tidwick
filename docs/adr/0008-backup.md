# 0008 Encrypted, off-account, drilled backups

Date: 2026-11-22
Status: Accepted

## Context

One Cloudflare account is one failure domain, and a backup that was never restored is a hope. Backups hold client data and must be useless to whoever finds them.

## Decision

- A nightly dump is NDJSON, gzipped, then age-encrypted to an offline X25519 public key.
- Dump and restore share core code, and a restore drill exercises it.
- The ciphertext is written to R2, then copied to a second Cloudflare account through the R2 S3 API; the night is ok only when both land.
- A write is tried up to three times, and each object key carries its UTC time (`backups/YYYY/MM/DD-HHMMSS`), so a retry or a second backup the same day never overwrites one.
- Retention is a bucket lifecycle rule, the only deletion: 35 days here, 40 off-account; a retired `NOTE_KEK` is kept 40 days.
- The dump is built in memory under a character budget; streaming is the named fix when it is outgrown.

## Consequences

- The private key never touches the deployment.
- A bad night is visible, not silent.
- Growth past the budget fails loudly rather than corrupting a backup.
