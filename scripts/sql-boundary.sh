#!/usr/bin/env bash
# Every SQL statement lives under src/db/: fails on `.prepare(` in any file outside it, and on `.exec(` called with a string literal (a SQL
# statement, not a RegExp, which takes a variable) in any non-test file outside it, since tests seed through helpers that predate the rule.
# Takes the tree to scan as an optional argument, so sql-boundary.test.sh can scan a mutated copy.
set -uo pipefail
cd "${1:-$(dirname "$0")/..}"
dirs=$(for d in src test scripts e2e; do [ -d "$d" ] && echo "$d"; done)
# test/ holds seeding helpers that predate the rule, so the .exec( scan skips it.
execdirs=$(for d in src scripts e2e; do [ -d "$d" ] && echo "$d"; done)
inc=(--include='*.ts' --include='*.tsx' --include='*.astro' --include='*.js' --include='*.mjs')
# shellcheck disable=SC2086
hits=$({
  grep -rn -F '.prepare(' "${inc[@]}" $dirs
  grep -rnE '\.exec\(['"'"'"`]' "${inc[@]}" --exclude='*.test.*' $execdirs
} | grep -v '^src/db/')
if [ -n "$hits" ]; then
  echo "FAIL lint-sql-boundary: SQL outside src/db/; move the statement into a src/db/ module beside its row type:"
  echo "$hits" | head -20
  exit 1
fi
echo "PASS lint-sql-boundary"
