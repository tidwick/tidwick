#!/usr/bin/env bash
# Proves deploy-check.sh with a stubbed wrangler: the required secrets alone pass (prod and demo), a missing one fails
# naming it, a placeholder in wrangler.jsonc fails, and an opt-out of the off-account copy drops the four S3 secrets.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
cat > wrangler-stub.sh <<'STUB'
#!/usr/bin/env bash
printf '['
sep=''
for name in $STUB_SECRETS; do printf '%s{"name": "%s", "type": "secret_text"}' "$sep" "$name"; sep=','; done
printf ']\n'
STUB
chmod +x wrangler-stub.sh
export WRANGLER="$work/wrangler-stub.sh"
prod='SESSION_SECRET NOTE_KEK BACKUP_RECIPIENT BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY_ID BACKUP_S3_SECRET'
demo='SESSION_SECRET NOTE_KEK BACKUP_RECIPIENT DEMO_PASSWORD'
write_config() { printf '{\n"vars": {\n"ORIGIN": "https://time.firm.test",\n"BACKUP_COPY": "%s"\n},\n"env": {"demo": {"vars": {\n"BACKUP_COPY": "none"\n}}}\n}\n' "$1" > wrangler.jsonc; }
expect() { # name, want (0 pass / 1 fail), secrets, args...
  local name="$1" want="$2" secrets="$3"
  shift 3
  local got=0
  STUB_SECRETS="$secrets" "$repo/scripts/deploy-check.sh" "$@" > out.txt 2>&1 || got=1
  if [ "$got" != "$want" ]; then
    echo "FAIL deploy-check self-test: $name; fix scripts/deploy-check.sh"
    cat out.txt
    exit 1
  fi
}
write_config s3
expect 'prod with exactly the required secrets must pass' 0 "$prod"
expect 'prod with an optional secret too must pass' 0 "$prod SETUP_TOKEN MCP"
expect 'prod missing BACKUP_S3_SECRET must fail' 1 "${prod% BACKUP_S3_SECRET}"
grep -q 'BACKUP_S3_SECRET' out.txt || { echo "FAIL deploy-check self-test: the failure does not name BACKUP_S3_SECRET"; exit 1; }
expect 'demo with exactly the required secrets must pass' 0 "$demo" demo
expect 'demo missing DEMO_PASSWORD must fail' 1 "${demo% DEMO_PASSWORD}" demo
expect 'an unknown env must fail' 1 "$prod" staging
write_config none
expect 'an opted-out instance needs no S3 secrets' 0 'SESSION_SECRET NOTE_KEK BACKUP_RECIPIENT'
write_config s3
printf '{\n"vars": {\n"ORIGIN": "https://example.com",\n"BACKUP_COPY": "s3"\n}\n}\n' > wrangler.jsonc
expect 'a placeholder in wrangler.jsonc must fail' 1 "$prod"
echo "PASS deploy-check self-test"
