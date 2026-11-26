#!/usr/bin/env bash
# DELETE ME with demo-squash-once.sh. Proves it against real SQLite behind a stub wrangler: on a database with the
# agent tables and the demo marker it drops them and the folded migration rows and keeps the data; with the tables
# but no marker (a real instance) it changes nothing; without the tables it changes nothing; a second run is a no-op.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
cat > wrangler-stub.sh <<'STUB'
#!/usr/bin/env bash
# wrangler d1 execute <db> <flags...> [--json] --command <sql>, answered by sqlite3 on $STUB_DB.
sql=''
json=''
while [ $# -gt 0 ]; do
  case "$1" in
    --command) sql="$2"; shift ;;
    --json) json=1 ;;
  esac
  shift
done
if [ -n "$json" ]; then
  rows="$(sqlite3 -json "$STUB_DB" "$sql")"
  printf '[{"results": %s, "success": true}]\n' "${rows:-[]}"
else
  sqlite3 "$STUB_DB" "$sql"
fi
STUB
chmod +x wrangler-stub.sh
export WRANGLER="$work/wrangler-stub.sh" STUB_DB="$work/d1.sqlite"
fail() { echo "FAIL demo-squash-once self-test: $1; fix scripts/demo-squash-once.sh"; [ ! -f out.txt ] || cat out.txt; exit 1; }
made() { # agent tables (yes|no), demo marker (yes|no)
  rm -f "$STUB_DB"
  sqlite3 "$STUB_DB" "
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);
    INSERT INTO d1_migrations (name) VALUES ('0001_init.sql'), ('0002_firm_name_from_client.sql'), ('0004_drop_reserved_columns.sql');
    CREATE TABLE setting (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    INSERT INTO setting VALUES ('alert_to', '\"a@example.test\"');
    CREATE TABLE person (id TEXT PRIMARY KEY);
    INSERT INTO person VALUES ('p1');"
  [ "$2" != yes ] || sqlite3 "$STUB_DB" "INSERT INTO setting VALUES ('demo', '1');"
  [ "$1" != yes ] || sqlite3 "$STUB_DB" "
    CREATE TABLE agent_grant (id TEXT PRIMARY KEY);
    CREATE TABLE agent_token (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES agent_grant (id));"
}
run() { "$repo/scripts/demo-squash-once.sh" tidwick-db --remote > out.txt 2>&1 || fail "the script exited non-zero"; }
tables() { sqlite3 "$STUB_DB" "SELECT group_concat(name) FROM (SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name)"; }
migrations() { sqlite3 "$STUB_DB" "SELECT group_concat(name) FROM d1_migrations"; }

made yes yes
run
grep -q '^PASS demo-squash-once: the demo' out.txt || fail "the demo database was not reset"
[ "$(tables)" = 'd1_migrations,person,setting,sqlite_sequence' ] || fail "the agent tables are still there: $(tables)"
[ "$(migrations)" = '0001_init.sql' ] || fail "the folded migration rows are still there: $(migrations)"
[ "$(sqlite3 "$STUB_DB" 'SELECT id FROM person')" = p1 ] || fail "the demo's data did not survive"
run
grep -q 'no agent table' out.txt || fail "a second run was not a no-op"

made yes no
before="$(sqlite3 "$STUB_DB" .dump)"
run
grep -q 'not the demo database' out.txt || fail "an unmarked database with agent tables was not left alone"
[ "$(sqlite3 "$STUB_DB" .dump)" = "$before" ] || fail "an unmarked database changed"

made no yes
before="$(sqlite3 "$STUB_DB" .dump)"
run
[ "$(sqlite3 "$STUB_DB" .dump)" = "$before" ] || fail "a database without agent tables changed"
echo "PASS demo-squash-once self-test"
