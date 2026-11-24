#!/usr/bin/env bash
# Proves contrast.ts: the stylesheet as committed passes, and the same stylesheet fails, naming the pair, when a
# text colour is pushed toward its background, when the control border loses its contrast, when the focus ring
# is pushed toward the muted surface a focused control sits on, and when a token a pair needs is missing.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
css="$repo/src/styles/global.css"
check() { node "$repo/scripts/contrast.ts" "$work/$1.css" > "$work/$1.log"; }

cp "$css" "$work/clean.css"
if ! check clean; then
  cat "$work/clean.log"
  echo "FAIL contrast self-test: the committed stylesheet fails; fix the pairs above first"
  exit 1
fi
sed 's#^\(  --muted-foreground: \).*#\1oklch(0.8 0 0);#' "$css" > "$work/text.css"
if check text || ! grep -q 'FAIL.*muted-foreground on background' "$work/text.log"; then
  echo "FAIL contrast self-test: a pale muted text colour passed; fix the ratio check in scripts/contrast.ts"
  exit 1
fi
sed 's#^\(  --control: \).*#\1oklch(0.9 0 0);#' "$css" > "$work/control.css"
if check control || ! grep -q 'FAIL.*control on background' "$work/control.log"; then
  echo "FAIL contrast self-test: a pale control border passed; fix the 3:1 control threshold in scripts/contrast.ts"
  exit 1
fi
sed 's#^\(  --ring: \).*#\1oklch(0.93 0.01 260);#' "$css" > "$work/ring.css"
if check ring || ! grep -q 'FAIL.*ring on muted' "$work/ring.log"; then
  echo "FAIL contrast self-test: a pale focus ring passed on the muted surface; add the ring on muted pair back to scripts/contrast.ts"
  exit 1
fi
grep -v '^  --danger-surface:' "$css" > "$work/missing.css"
if check missing || ! grep -q 'FAIL.*danger-surface' "$work/missing.log"; then
  echo "FAIL contrast self-test: a pair naming a missing token passed; fix the token lookup in scripts/contrast.ts"
  exit 1
fi
echo "PASS contrast self-test"
