#!/usr/bin/env bash
# Before the first release tag the init migration may be edited, and a deploy applies migrations by name, so a demo
# that already ran the old 0001_init.sql would keep the old schema. `just deploy demo` runs this first. Usage:
# scripts/demo-schema-sync.sh <database> <wrangler flags for the demo, without --remote>.
# It acts only on a database that carries the demo seed's marker (setting 'demo' = 1, which no real instance has).
# When that database's recorded hash of migrations/0001_init.sql (setting demo_init_sha) is not the shipped file's, it
# runs the demo reset (every table dropped, migrations applied again, the seed loaded) under a new random NOTE_KEK,
# sets that as the demo Worker's NOTE_KEK secret (the demo holds invented notes only), and records the hash last, so a
# failure part-way is retried by the next deploy. Post-tag the guard forbids the edit, so this never fires.
# WRANGLER and JUST name the commands that run wrangler and just.
set -euo pipefail
wrangler="${WRANGLER:-npx --no-install wrangler}"
just="${JUST:-just}"
db="${1:?usage: scripts/demo-schema-sync.sh <database> <wrangler flags, without --remote>}"
shift
flags=("$@")
one() { # SQL: the first column of its first row, empty for no row
  $wrangler d1 execute "$db" --remote "${flags[@]}" --json --command "$1" | node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
      const row = JSON.parse(text)[0].results[0];
      console.log(row === undefined ? "" : Object.values(row)[0]);
    });'
}
[ "$(one "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'setting'")" != 0 ] || { echo "PASS demo-schema-sync: no setting table, nothing to compare"; exit 0; }
[ "$(one "SELECT count(*) FROM setting WHERE key = 'demo' AND value_json = '1'")" = 1 ] || { echo "PASS demo-schema-sync: not the demo database, left alone"; exit 0; }
shipped="$(node -e 'console.log(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync("migrations/0001_init.sql")).digest("hex"))')"
[ "$(one "SELECT value_json FROM setting WHERE key = 'demo_init_sha'")" != "\"$shipped\"" ] || { echo "PASS demo-schema-sync: the demo's init migration is the shipped one"; exit 0; }
kek="$(openssl rand -base64 32)"
printf 'NOTE_KEK=%s\n' "$kek" | $just demo-reset remote || { echo "FAIL demo-schema-sync: the demo reset did not finish; fix what it printed and deploy again"; exit 1; }
printf '%s' "$kek" | $wrangler secret put NOTE_KEK "${flags[@]}" > /dev/null || { echo "FAIL demo-schema-sync: the demo's NOTE_KEK secret was not set; deploy again (the demo's notes cannot be read until it is)"; exit 1; }
one "INSERT OR REPLACE INTO setting (key, value_json) VALUES ('demo_init_sha', '\"$shipped\"')" > /dev/null
echo "PASS demo-schema-sync: the demo was reset to the shipped init migration"
