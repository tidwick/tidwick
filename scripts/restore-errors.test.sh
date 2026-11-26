#!/usr/bin/env bash
# Proves the restore and gen-test-keys failure text: a missing identity, a missing backup, a backup that does not
# open, and a missing or malformed expected head each print one FAIL line naming the path and the next step, never a stack; gen-test-keys removes the backup
# it orphans and says to run backup-fixture. Works in a throwaway directory; test/fixtures/ is untouched.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$repo"

fail() {
  echo "FAIL restore-errors self-test: $1"
  exit 1
}

head="0:$(printf '0%.0s' $(seq 64))"

# expect_args <label> <text the one FAIL line must hold> <every arg to restore.ts>
expect_args() {
  local label="$1" want="$2" out
  shift 2
  if out="$(node scripts/restore.ts "$@" 2>&1)"; then
    fail "$label: restore.ts exited 0; it must refuse"
  fi
  [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" = 1 ] || fail "$label: printed more than one line (a stack?): $out; guard the read in scripts/restore.ts"
  case "$out" in
    "FAIL restore: "*"$want"*) ;;
    *) fail "$label: printed '$out', wanted a FAIL line holding '$want'; fix the message in scripts/restore.ts" ;;
  esac
}

# expect <label> <text the one FAIL line must hold> <backup file> <identity file>
expect() {
  local label="$1" want="$2"
  shift 2
  expect_args "$label" "$want" "$@" "$work/out.sql" "$head"
}

expect "missing identity" "$work/none.txt does not exist" "$work/backup.age" "$work/none.txt"

touch "$work/backup.age"
gen="$(node scripts/gen-test-keys.ts "$work")"
[ -e "$work/backup.age" ] && fail "gen-test-keys left a backup.age encrypted to the old key; remove it in scripts/gen-test-keys.ts"
case "$gen" in
  *'just backup-fixture'*) ;;
  *) fail "gen-test-keys printed '$gen' without naming just backup-fixture; fix scripts/gen-test-keys.ts" ;;
esac

expect "missing backup" "just backup-fixture" "$work/backup.age" "$work/backup-key.txt"

printf 'not an age file\n' > "$work/backup.age"
expect "backup for another key" "just backup-fixture" "$work/backup.age" "$work/backup-key.txt"

expect_args "no expected head" "usage: restore.ts" "$work/backup.age" "$work/backup-key.txt" "$work/out.sql"
expect_args "malformed expected head" "must be seq:hash" "$work/backup.age" "$work/backup-key.txt" "$work/out.sql" "12:abc"

echo "PASS restore-errors self-test"
