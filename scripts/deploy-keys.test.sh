#!/usr/bin/env bash
# Proves deploy-keys keeps the backup decryption identity out of the kit directory, tells the owner where it is, and
# refuses to run over an existing key. Works in a throwaway directory.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$repo"

# A stub age-keygen, so the test needs no age install: -o writes a dummy identity, -y a dummy recipient.
mkdir "$work/bin"
cat > "$work/bin/age-keygen" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "-o" ]; then echo "AGE-SECRET-KEY-STUB" > "$2"; else echo "age1stubrecipient"; fi
STUB
chmod +x "$work/bin/age-keygen"
export PATH="$work/bin:$PATH"

fail() {
  echo "FAIL deploy-keys self-test: $1"
  exit 1
}

out="$(just deploy-keys "$work/kit" "$work/offline" 2>&1)" || fail "deploy-keys failed: $out"
[ ! -e "$work/kit/backup-key.txt" ] || fail "the identity is in the kit directory; write it only to the identity directory in the justfile"
for f in backup-recipient.txt session-secret note-kek; do
  [ -s "$work/kit/$f" ] || fail "$f is missing from the kit; deploy-secrets reads it"
done
[ -s "$work/offline/backup-key.txt" ] || fail "the identity is missing from the identity directory"
case "$out" in
  *"$work/offline/backup-key.txt"*offline*) ;;
  *) fail "the PASS line does not say where the identity is and to move it offline: $out" ;;
esac
rm -r "$work/offline"
if again="$(just deploy-keys "$work/kit" "$work/offline" 2>&1)"; then
  fail "deploy-keys ran over an existing kit whose identity had been moved away; it must refuse"
fi
case "$again" in
  "FAIL deploy-keys: "*) ;;
  *) fail "the refusal is not a FAIL line: $again" ;;
esac
echo "PASS deploy-keys self-test"
