#!/usr/bin/env bash
# Source files stay at 250 lines or fewer. No exemptions.
set -uo pipefail
cd "$(dirname "$0")/.."
over=$(git ls-files --cached --others --exclude-standard -- 'src/*.ts' 'src/*.tsx' 'src/*.astro' 'src/*.css' \
  | xargs wc -l 2>/dev/null | awk '$2 != "total" && $1 > 250 {print $2 " (" $1 " lines)"}')
if [ -n "$over" ]; then
  echo "FAIL size-guard: split these files by concern (limit 250 lines):"
  echo "$over"
  exit 1
fi
echo "PASS size-guard"
