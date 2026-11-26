#!/usr/bin/env bash
# Before a deploy: wrangler.jsonc holds no placeholder, and every secret the target needs is set on it. Usage:
# scripts/deploy-check.sh [demo]. Optional secrets (NOTE_KEK_PREVIOUS, MCP, SSO_PROVIDERS, SETUP_TOKEN, ...) are never
# demanded. WRANGLER names the command that runs wrangler; the test points it at a stub.
set -euo pipefail
wrangler="${WRANGLER:-npx --no-install wrangler}"
case "${1:-}" in
  "")
    flags=()
    todo='example\.com|localhost'
    need='SESSION_SECRET NOTE_KEK BACKUP_RECIPIENT'
    # The first BACKUP_COPY in the file is the top-level one; an instance that opts out sets it to none.
    if ! grep -m1 '"BACKUP_COPY"' wrangler.jsonc | grep -q '"none"'; then
      need="$need BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY_ID BACKUP_S3_SECRET"
    fi
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
have="$($wrangler secret list "${flags[@]}" --format json | grep -oE '"name": *"[A-Z_0-9]+"' | grep -oE '[A-Z_0-9]+"$' | tr -d '"')"
missing=''
for name in $need; do
  grep -qx "$name" <<< "$have" || missing="$missing $name"
done
[ -z "$missing" ] || { echo "FAIL deploy-check: secrets not set on the target:$missing; run just deploy-secrets"; exit 1; }
echo "PASS deploy-check"
