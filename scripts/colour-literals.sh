#!/usr/bin/env bash
# Colour lives in one place: the tokens in src/styles/global.css. Fails on a hex, rgb, hsl or oklch literal, or a named palette utility such as `bg-white` or
# `text-slate-900`, anywhere else under src/, since each is a colour that dark mode cannot restyle. An in-page link
# such as href="#main" is not a colour. Takes the tree to scan as an optional argument.
set -uo pipefail
cd "${1:-$(dirname "$0")/..}"
palette='(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'
use='(bg|text|border|ring|fill|stroke|from|to|via|outline|divide|decoration|accent|caret|shadow)'
functions='\b(rgba?|hsla?|oklch|oklab|hwb|lab|lch)\('
named="\\b$use-(white|black|$palette-[0-9]{2,3})\\b"
hex='.{0,8}(^|[^[:alnum:]&_/=-])#[0-9a-fA-F]{3,8}([^[:alnum:]_-]|$)'
scan() { grep -rnIE "$1" src | grep -v -e '^src/styles/global\.css:'; }
hits=$( { scan "$functions"; scan "$named"; grep -rnIoE "$hex" src | grep -v -e '^src/styles/global\.css:' | grep -vE "(href|for|id)=[\"']?#"; } | sort -u)
if [ -n "$hits" ]; then
  echo "FAIL colour-literals: a raw colour outside src/styles/global.css; use a token (bg-background, text-foreground, text-muted-foreground, border-border, text-danger) or add one to global.css with its contrast pair:"
  echo "$hits" | head -20
  exit 1
fi
echo "PASS: no hex or rgb literal outside src/styles/global.css"
