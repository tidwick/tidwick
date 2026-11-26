#!/usr/bin/env bash
# Proves demo-schema-sync.sh against real SQLite behind a stub wrangler and a stub `just demo-reset`: a demo whose
# recorded init hash differs (or is missing) is reset, gets a new NOTE_KEK secret and the new hash; one whose hash
# matches is left alone; a database without the demo marker (a real instance) is never touched, whatever its hash;
# an empty database is left alone; a failed reset or secret leaves no hash, so the next deploy retries.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
mkdir migrations
echo 'CREATE TABLE a (id TEXT);' > migrations/0001_init.sql
cat > wrangler-stub.sh <<'STUB'
#!/usr/bin/env bash
# wrangler d1 execute <db> --remote <flags...> --json --command <sql> is answered by sqlite3 on $STUB_DB;
# wrangler secret put NAME <flags...> logs NAME and the flags, and fails when $STUB_SECRET_FAILS is set.
if [ "$1" = secret ]; then
  [ -z "${STUB_SECRET_FAILS:-}" ] || exit 1
  echo "$* $(cat)" >> "$STUB_LOG"
  exit 0
fi
sql=''
while [ $# -gt 0 ]; do
  [ "$1" != --command ] || { sql="$2"; shift; }
  shift
done
rows="$(sqlite3 -json "$STUB_DB" "$sql")"
printf '[{"results": %s, "success": true}]\n' "${rows:-[]}"
STUB
cat > just-stub.sh <<'STUB'
#!/usr/bin/env bash
# just demo-reset remote: logs the standard input's NOTE_KEK line, then drops everything and loads a marked demo.
[ "$*" = 'demo-reset remote' ] || exit 2
[ -z "${STUB_RESET_FAILS:-}" ] || exit 1
cat >> "$STUB_LOG"
rm -f "$STUB_DB"
sqlite3 "$STUB_DB" "CREATE TABLE d1_migrations (name TEXT); CREATE TABLE setting (key TEXT PRIMARY KEY, value_json TEXT NOT NULL); INSERT INTO setting VALUES ('demo', '1'); CREATE TABLE person (id TEXT);"
STUB
chmod +x wrangler-stub.sh just-stub.sh
export WRANGLER="$work/wrangler-stub.sh" JUST="$work/just-stub.sh" STUB_DB="$work/d1.sqlite" STUB_LOG="$work/log.txt"
shipped="$(node -e 'console.log(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync("migrations/0001_init.sql")).digest("hex"))')"
fail() { echo "FAIL demo-schema-sync self-test: $1; fix scripts/demo-schema-sync.sh"; [ ! -f out.txt ] || cat out.txt; exit 1; }
made() { # demo marker (yes|no), recorded hash ("" for none)
  rm -f "$STUB_DB" "$STUB_LOG"
  : > "$STUB_LOG"
  sqlite3 "$STUB_DB" "CREATE TABLE setting (key TEXT PRIMARY KEY, value_json TEXT NOT NULL); CREATE TABLE person (id TEXT); INSERT INTO person VALUES ('old');"
  [ "$1" != yes ] || sqlite3 "$STUB_DB" "INSERT INTO setting VALUES ('demo', '1');"
  [ -z "$2" ] || sqlite3 "$STUB_DB" "INSERT INTO setting VALUES ('demo_init_sha', '\"$2\"');"
}
run() { "$repo/scripts/demo-schema-sync.sh" tidwick-db --config wrangler.jsonc --env demo > out.txt 2>&1; }
people() { sqlite3 "$STUB_DB" "SELECT count(*) FROM person"; }
recorded() { sqlite3 "$STUB_DB" "SELECT value_json FROM setting WHERE key = 'demo_init_sha'"; }

made yes stale
run || fail "a stale demo was not reset"
grep -q '^PASS demo-schema-sync: the demo was reset' out.txt || fail "the reset line is missing"
[ "$(people)" = 0 ] || fail "the old data survived the reset"
[ "$(recorded)" = "\"$shipped\"" ] || fail "the new hash was not recorded: $(recorded)"
kek="$(sed -n 's/^NOTE_KEK=//p' "$STUB_LOG")"
[ "${#kek}" = 44 ] || fail "the reset got no 32-byte NOTE_KEK on standard input"
grep -q "^secret put NOTE_KEK --config wrangler.jsonc --env demo $kek\$" "$STUB_LOG" || fail "the Worker's NOTE_KEK secret is not the reset's"
run || fail "a second run failed"
grep -q 'is the shipped one' out.txt || fail "a second run was not a no-op"

made yes ''
run || fail "a demo with no recorded hash was not reset"
[ "$(people)" = 0 ] || fail "a demo with no recorded hash was not reset"

made yes "$shipped"
run || fail "a current demo failed"
[ "$(people)" = 1 ] && [ ! -s "$STUB_LOG" ] || fail "a current demo was reset"

for hash in '' stale; do
  made no "$hash"
  before="$(sqlite3 "$STUB_DB" .dump)"
  run || fail "an unmarked database failed"
  grep -q 'not the demo database' out.txt || fail "an unmarked database (hash '$hash') was not left alone"
  [ "$(sqlite3 "$STUB_DB" .dump)" = "$before" ] && [ ! -s "$STUB_LOG" ] || fail "an unmarked database (hash '$hash') changed"
done

rm -f "$STUB_DB"
sqlite3 "$STUB_DB" "CREATE TABLE person (id TEXT);"
run || fail "an empty database failed"
grep -q 'no setting table' out.txt || fail "an empty database was not left alone"

made yes stale
STUB_RESET_FAILS=1 run && fail "a failed reset must fail"
grep -q '^FAIL demo-schema-sync' out.txt || fail "a failed reset printed no FAIL line"
[ "$(recorded)" = '"stale"' ] || fail "a failed reset recorded a hash"
made yes stale
STUB_SECRET_FAILS=1 run && fail "a failed secret must fail"
grep -q '^FAIL demo-schema-sync' out.txt || fail "a failed secret printed no FAIL line"
[ -z "$(recorded)" ] || fail "a failed secret recorded a hash, so no retry would follow"
echo 'PASS demo-schema-sync self-test'
