#!/usr/bin/env bash
# Proves deploy-check.sh with a stubbed wrangler that logs its arguments: the required secrets alone pass (prod and
# demo), each one missing fails by name, a near-miss name does not count, an optional secret is never demanded, a
# placeholder fails, the demo is addressed with --env demo, and a BACKUP_COPY that is not exactly s3 or none at the top
# level fails (a demo-only or commented "none" must not open the gate).
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
cat > wrangler-stub.sh <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
printf '['
sep=''
for name in $STUB_SECRETS; do printf '%s{"name": "%s", "type": "secret_text"}' "$sep" "$name"; sep=','; done
printf ']\n'
STUB
chmod +x wrangler-stub.sh
export WRANGLER="$work/wrangler-stub.sh" STUB_LOG="$work/args.log"
keys='SESSION_SECRET NOTE_KEK BACKUP_RECIPIENT'
s3='BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY_ID BACKUP_S3_SECRET'
prod="$keys $s3"
demo="$keys DEMO_PASSWORD"
fail() { echo "FAIL deploy-check self-test: $1; fix scripts/deploy-check.sh"; [ ! -f out.txt ] || cat out.txt; exit 1; }
config() { # top-level BACKUP_COPY line (or empty), origin
  printf '{\n// "BACKUP_COPY": "none",\n"vars": {\n"ORIGIN": "%s",\n%s\n},\n"env": {"demo": {"vars": {\n"BACKUP_COPY": "none",\n"X": "%s"\n}}}\n}\n' "$2" "$1" "${3:-https://demo.firm.test}" > wrangler.jsonc
}
run() { # secrets, args...
  local secrets="$1"
  shift
  : > "$STUB_LOG"
  STUB_SECRETS="$secrets" "$repo/scripts/deploy-check.sh" "$@" > out.txt 2>&1 && return 0 || return 1
}
passes() { run "$2" "${@:3}" || fail "$1 must pass"; }
refuses() { run "$2" "${@:3}" && fail "$1 must fail"; grep -q '^FAIL deploy-check' out.txt || fail "$1 printed no FAIL line"; return 0; }
without() { local out='' n; for n in $1; do [ "$n" = "$2" ] || out="$out $n"; done; echo "$out"; }

config '"BACKUP_COPY": "s3"' https://time.firm.test
passes 'prod with exactly the required secrets' "$prod"
grep -q -- '--env' "$STUB_LOG" && fail 'prod must not pass --env'
passes 'prod with optional secrets too' "$prod SETUP_TOKEN MCP MCP_CLIENTS NOTE_KEK_PREVIOUS"
for name in $prod; do
  refuses "prod missing $name" "$(without "$prod" "$name")"
  grep -q "$name" out.txt || fail "the failure for $name does not name it"
done
refuses 'a near-miss secret name (SESSION_SECRET_OLD for SESSION_SECRET)' "$(without "$prod" SESSION_SECRET) SESSION_SECRET_OLD"
refuses 'an empty secret list' ''
passes 'demo with exactly the required secrets' "$demo" demo
grep -q -- '--env demo' "$STUB_LOG" || fail 'demo must pass --env demo to wrangler'
for name in $demo; do
  refuses "demo missing $name" "$(without "$demo" "$name")" demo
  grep -q "$name" out.txt || fail "the demo failure for $name does not name it"
done
refuses 'an unknown env' "$prod" staging

config '"BACKUP_COPY": "none"' https://time.firm.test
passes 'an opted-out instance needs no S3 secrets' "$keys"
config '"BACKUP_COPY": "S3"' https://time.firm.test
refuses 'BACKUP_COPY that is not exactly s3 or none' "$prod"
config '' https://time.firm.test
refuses 'no top-level BACKUP_COPY (the demo env block and a comment hold "none")' "$keys"
config '"BACKUP_COPY": "s3"' http://localhost:4321
refuses 'a localhost ORIGIN on prod' "$prod"
config '"BACKUP_COPY": "s3"' https://time.example.com
refuses 'an example.com ORIGIN on prod' "$prod"
config '"BACKUP_COPY": "s3"' https://time.firm.test REPLACE_WITH_ID
refuses 'a REPLACE_WITH placeholder on demo' "$demo" demo
passes 'a REPLACE_WITH in the demo block does not stop prod' "$prod"

# workers.dev left on with a custom-domain ORIGIN warns (it does not fail); off, or ORIGIN on workers.dev, stays quiet.
config '"BACKUP_COPY": "s3"' https://time.firm.test
sed -i.bak 's/^"vars": {/"workers_dev": true,\n"vars": {/' wrangler.jsonc
passes 'workers_dev on with a custom domain' "$prod"
grep -q '^WARN deploy-check: workers_dev' out.txt || fail 'workers_dev on with a custom domain printed no WARN'
sed -i.bak 's#https://time.firm.test#https://tidwick.firm.workers.dev#' wrangler.jsonc
passes 'workers_dev on with a workers.dev ORIGIN' "$prod"
! grep -q '^WARN' out.txt || fail 'a workers.dev ORIGIN must not warn'
config '"BACKUP_COPY": "s3"' https://time.firm.test
passes 'workers_dev unset' "$prod"
! grep -q '^WARN' out.txt || fail 'workers_dev unset must not warn'
echo "PASS deploy-check self-test"
