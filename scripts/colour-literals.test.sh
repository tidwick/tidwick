#!/usr/bin/env bash
# Proves colour-literals.sh: a copy of src/ passes, and the same copy fails, naming the file, once each kind of raw
# colour is planted outside the tokens; the stylesheet stays free to hold them.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$repo/src" "$work/"
if ! "$repo/scripts/colour-literals.sh" "$work" > "$work/clean.log"; then
  cat "$work/clean.log"
  echo "FAIL colour-literals self-test: the unmutated tree fails; fix the hits above first"
  exit 1
fi
plant() {
  printf '%s\n' "$2" > "$work/src/$1"
  if "$repo/scripts/colour-literals.sh" "$work" > "$work/mutant.log" || ! grep -q "src/$1" "$work/mutant.log"; then
    echo "FAIL colour-literals self-test: $3 in src/$1 was not named; fix the pattern in scripts/colour-literals.sh"
    exit 1
  fi
  rm "$work/src/$1"
}
plant lib/leak-hex.ts "export const edge = '#1a2b3c';" "a six digit hex"
plant lib/leak-short.ts "export const edge = '#fff';" "a three digit hex"
plant lib/leak-rgb.ts "export const edge = 'rgb(10 20 30)';" "an rgb value"
plant lib/leak-rgba.ts "export const edge = 'rgba(10, 20, 30, 0.5)';" "an rgba value"
plant lib/leak-hsl.ts "export const edge = 'hsl(200 50% 50%)';" "an hsl value"
plant lib/leak-oklch.ts "export const edge = 'oklch(0.5 0.1 200)';" "an oklch value"
plant pages/leak-class.astro '<p class="bg-white text-slate-900">x</p>' "a named palette class"
printf '<a href="#main">skip</a><p id="add">x</p>\n' > "$work/src/pages/anchor.astro"
if ! "$repo/scripts/colour-literals.sh" "$work" > "$work/anchor.log"; then
  cat "$work/anchor.log"
  echo "FAIL colour-literals self-test: an in-page anchor was read as a hex colour; tighten the hex pattern in scripts/colour-literals.sh"
  exit 1
fi
plant components/ui/leak.tsx "export const edge = '#1a2b3c';" "a hex in the component library"
plant styles/extra.css ".x { color: #123456; }" "a hex in a second stylesheet"
printf '.x { color: #123456; }\n' >> "$work/src/styles/global.css"
if ! "$repo/scripts/colour-literals.sh" "$work" > "$work/exempt.log"; then
  cat "$work/exempt.log"
  echo "FAIL colour-literals self-test: the stylesheet was refused; keep it exempt in scripts/colour-literals.sh"
  exit 1
fi
echo "PASS colour-literals self-test"
