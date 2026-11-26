#!/usr/bin/env bash
# Before a deploy: wrangler.jsonc holds no placeholder, and every secret the target needs is set on it. Usage:
# scripts/deploy-check.sh [demo]. Optional secrets (NOTE_KEK_PREVIOUS, MCP, MCP_CLIENTS, SSO_PROVIDERS, SETUP_TOKEN, ...) are never
# demanded. WRANGLER names the command that runs wrangler; the test points it at a stub.
set -euo pipefail
wrangler="${WRANGLER:-npx --no-install wrangler}"
case "${1:-}" in
  "")
    flags=()
    todo='example\.com|localhost'
    need='SESSION_SECRET NOTE_KEK BACKUP_RECIPIENT'
    # The top-level BACKUP_COPY only (the lines before "env", comments skipped): exactly s3 or none, else FAIL.
    copy="$(sed '/"env"/q' wrangler.jsonc | grep -vE '^[[:space:]]*//' | sed -nE 's/.*"BACKUP_COPY"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | head -1)"
    # A custom-domain ORIGIN with workers.dev still on: the app answers only on ORIGIN, but the second hostname stays up.
    top="$(sed '/"env"/q' wrangler.jsonc | grep -vE '^[[:space:]]*//')"
    host="$(sed -nE 's/.*"ORIGIN"[[:space:]]*:[[:space:]]*"https?:\/\/([^"\/:]*).*/\1/p' <<< "$top" | head -1)"
    if grep -qE '"workers_dev"[[:space:]]*:[[:space:]]*true' <<< "$top" && [[ "$host" != *.workers.dev ]]; then
      echo "WARN deploy-check: workers_dev is still true with ORIGIN on $host; set \"workers_dev\": false in wrangler.jsonc now that the custom domain serves it"
    fi
    case "$copy" in
      none) ;;
      s3) need="$need BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY_ID BACKUP_S3_SECRET" ;;
      *) echo "FAIL deploy-check: wrangler.jsonc's top-level BACKUP_COPY must be exactly \"s3\" or \"none\", not \"$copy\"; edit it as ARCHITECTURE, Deploy says"; exit 1 ;;
    esac
    ;;
  demo)
    flags=(--config wrangler.jsonc --env demo)
    todo='REPLACE_WITH'
    need='SESSION_SECRET NOTE_KEK BACKUP_RECIPIENT DEMO_PASSWORD'
    ;;
  *) echo "FAIL deploy-check: the env is empty or demo, not \"$1\""; exit 1 ;;
esac
if grep -nE "$todo" wrangler.jsonc; then
  echo "FAIL deploy-check: wrangler.jsonc still holds a placeholder (lines above); edit it as ARCHITECTURE, Deploy says"
  exit 1
fi
have="$($wrangler secret list ${flags[@]+"${flags[@]}"} --format json | grep -oE '"name": *"[A-Z_0-9]+"' | grep -oE '[A-Z_0-9]+"$' | tr -d '"' || true)"
missing=''
for name in $need; do
  grep -qx "$name" <<< "$have" || missing="$missing $name"
done
[ -z "$missing" ] || { echo "FAIL deploy-check: secrets not set on the target:$missing; run just deploy-secrets"; exit 1; }
echo "PASS deploy-check"
