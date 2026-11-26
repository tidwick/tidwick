#!/usr/bin/env bash
# DELETE ME with its test, its call in `just deploy` and the guard exception, in the PR after the first green demo
# deploy. Usage: scripts/demo-squash-once.sh <database> <wrangler d1 execute flags...>.
# The demo applied 0001 to 0004, which the squash folded into 0001_init.sql without the agent tables. It acts only on
# a database that still holds an agent table AND carries the demo seed's marker (setting 'demo' = 1, which no real
# instance has), so it can never touch one. It drops the two agent tables and the migration rows of the folded files;
# the demo's data stays, and the nightly wipe resets it as usual. WRANGLER names the command that runs wrangler.
set -euo pipefail
wrangler="${WRANGLER:-npx --no-install wrangler}"
db="${1:?usage: scripts/demo-squash-once.sh <database> <wrangler d1 execute flags...>}"
shift
one() { # SQL, then the wrangler flags: the first column of its first row, empty for no row
  local sql="$1"
  shift
  $wrangler d1 execute "$db" "$@" --json --command "$sql" | node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
      const row = JSON.parse(text)[0].results[0];
      console.log(row === undefined ? "" : Object.values(row)[0]);
    });'
}
agent="$(one "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('agent_grant', 'agent_token')" "$@")"
[ "$agent" != 0 ] || { echo "PASS demo-squash-once: no agent table, nothing to do"; exit 0; }
marked="$(one "SELECT count(*) FROM setting WHERE key = 'demo' AND value_json = '1'" "$@")"
[ "$marked" = 1 ] || { echo "PASS demo-squash-once: not the demo database, left alone"; exit 0; }
$wrangler d1 execute "$db" "$@" --command "DELETE FROM d1_migrations WHERE name <> '0001_init.sql'; DROP TABLE IF EXISTS agent_token; DROP TABLE IF EXISTS agent_grant;"
echo "PASS demo-squash-once: the demo's agent tables and folded migration rows are gone"
