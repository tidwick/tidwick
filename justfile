set shell := ["bash", "-euo", "pipefail", "-c"]

export WRANGLER_SEND_METRICS := "false"

default:
    @just --list

install:
    npm ci

dev: dev-vars
    npx --no-install wrangler types
    npx --no-install astro dev

dev-vars:
    node test/local/dev-vars.ts

dev-session who:
    @node test/local/dev-session.ts {{ quote(who) }}

dev-agent-token who:
    @node test/local/dev-agent-token.ts {{ quote(who) }}

dev-smoke who="grid-phone":
    #!/usr/bin/env bash
    set -euo pipefail
    cookie="$(just dev-session {{ quote(who) }})" || { echo "$cookie"; exit 1; }
    printf '%s\n' "$cookie" | node test/local/dev-smoke.ts

build:
    npx --no-install wrangler types
    npx --no-install astro build

test *args: build
    npx --no-install vitest run {{ args }}

golden: build
    npx --no-install vitest run -u

lint:
    npx --no-install eslint . --max-warnings 0

typecheck:
    npx --no-install wrangler types
    npx --no-install astro check

fmt:
    npx --no-install prettier --write .

fmt-check:
    npx --no-install prettier --check .

db-migrate *flags:
    npx --no-install wrangler d1 migrations apply tidwick --local --force {{ flags }}

migrate-check:
    #!/usr/bin/env bash
    set -euo pipefail
    state="$(mktemp -d)"
    trap 'rm -rf "$state"' EXIT
    just db-migrate --persist-to "$state" > "$state/apply.log" 2>&1 || { cat "$state/apply.log"; echo "FAIL migrate-check: wrangler could not apply migrations/ to a fresh local D1; fix the SQL named above"; exit 1; }
    echo "PASS migrate-check"

seed: dev-vars
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p .wrangler
    just db-migrate > .wrangler/seed.log 2>&1 || { cat .wrangler/seed.log; echo "FAIL seed: migrations did not apply to the local dev D1; fix the SQL named above"; exit 1; }
    node scripts/seed.ts --dev > .wrangler/seed.sql
    npx --no-install wrangler d1 execute tidwick --local --file .wrangler/seed.sql >> .wrangler/seed.log 2>&1 || { tail -n 40 .wrangler/seed.log; echo "FAIL seed: the synthetic seed did not load; the statement wrangler names above is in test/seed/"; exit 1; }
    node test/e2e/prepare.ts --reuse
    npx --no-install wrangler d1 execute tidwick --local --file .wrangler/e2e.sql >> .wrangler/seed.log 2>&1 || { tail -n 40 .wrangler/seed.log; echo "FAIL seed: the e2e fixture people did not load; see test/e2e/prepare.ts"; exit 1; }
    echo "PASS seed: 2 firms, 100 people, 40 projects, a key per client, ten rows with notes in the current week for Cora, thirty people with last week submitted and ten with the week before, and the fixture people (grid-phone, admin-desktop, ...) in the local dev D1; wrangler output in .wrangler/seed.log"

seed-demo target="local": (demo-load target "keep")

demo-reset target="local": (demo-load target "reset")

# The demo recipes' one body. `local` is the local dev D1; `remote` is the deployed demo's D1 from
# wrangler.jsonc env.demo, with the demo Worker's NOTE_KEK=... line on standard input. `reset` drops every table
# first, audit log included, then both modes migrate and load the demo seed.
[private]
demo-load target mode:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p .wrangler
    log=.wrangler/demo.log
    : > "$log"
    trap 'rm -f .wrangler/demo.sql .wrangler/demo-drop.sql' EXIT
    case {{ quote(target) }} in
      local)
        just dev-vars >> "$log"
        db=(tidwick --local)
        node scripts/seed-demo.ts --dev > .wrangler/demo.sql ;;
      remote)
        db=(tidwick-db --remote --config wrangler.jsonc --env demo)
        node scripts/seed-demo.ts .wrangler/demo.sql ;;
      *) echo "FAIL demo: the target is local or remote, not \"{{ target }}\""; exit 1 ;;
    esac
    if [ {{ quote(mode) }} = reset ]; then
      node scripts/seed-demo.ts --drop > .wrangler/demo-drop.sql
      npx --no-install wrangler d1 execute "${db[@]}" --file .wrangler/demo-drop.sql >> "$log" 2>&1 || { tail -n 40 "$log"; echo "FAIL demo-reset: the tables did not drop; the statement wrangler names above is in test/demo/reset.ts"; exit 1; }
    fi
    npx --no-install wrangler d1 migrations apply "${db[@]}" --force >> "$log" 2>&1 || { tail -n 40 "$log"; echo "FAIL demo: migrations did not apply to the {{ target }} D1; fix the SQL named above"; exit 1; }
    npx --no-install wrangler d1 execute "${db[@]}" --file .wrangler/demo.sql >> "$log" 2>&1 || { tail -n 40 "$log"; echo "FAIL demo: the demo seed did not load; the statement wrangler names above is built in test/demo/"; exit 1; }
    echo "PASS demo ({{ mode }}, {{ target }}): 2 invented firms, 25 people, 12 projects and thirteen weeks of time in the {{ target }} D1; wrangler output in $log"

# One command for a human to see the demo: reset and load the demo seed into the local D1, give the generated dummy
# .dev.vars the demo sign-in's signals (DEMO_LOGIN, DEMO_BANNER, a dummy DEMO_PASSWORD), then serve the production
# build with `astro preview` on http://localhost:4321/demo. Ctrl-C stops it. Pick a persona there: member, approver
# (accounting admin) or admin. The seed itself carries the fourth signal, and no real secret is involved.
demo-local:
    #!/usr/bin/env bash
    set -euo pipefail
    just demo-reset local
    # The demo signals go into .dev.vars for this run only; the file is put back on exit, so it must already exist.
    saved=.wrangler/dev.vars.saved
    trap 'if [ -e "$saved" ]; then install -m 600 "$saved" .dev.vars; rm -f "$saved"; fi' EXIT
    cp -p .dev.vars "$saved"
    { grep -vE '^DEMO_(LOGIN|BANNER|PASSWORD)=' "$saved"; printf 'DEMO_LOGIN=on\nDEMO_BANNER=on\nDEMO_PASSWORD=local-demo-password\n'; } > .dev.vars
    echo "demo: http://localhost:4321/demo  password: local-demo-password"
    just build
    npx --no-install astro preview

bootstrap email name firm out=".wrangler/bootstrap.sql":
    mkdir -p "$(dirname {{ quote(out) }})"
    node scripts/bootstrap.ts {{ quote(email) }} {{ quote(name) }} {{ quote(firm) }} {{ quote(out) }}

rescue person seq hash out=".wrangler/rescue.sql":
    mkdir -p "$(dirname {{ quote(out) }})"
    node scripts/rescue.ts {{ quote(person) }} {{ quote(seq) }} {{ quote(hash) }} {{ quote(out) }}

gen-test-keys:
    node scripts/gen-test-keys.ts

backup-fixture:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -f test/fixtures/backup-recipient.txt ] || just gen-test-keys
    state=.wrangler/drill
    rm -rf "$state" && mkdir -p "$state"
    just db-migrate --config test/wrangler.test.jsonc --persist-to "$state/source" > "$state/migrate.log" 2>&1 || { cat "$state/migrate.log"; echo "FAIL backup-fixture: migrations did not apply to the drill source; fix the SQL named above"; exit 1; }
    node scripts/seed.ts > "$state/seed.sql"
    npx --no-install wrangler d1 execute tidwick --local --config test/wrangler.test.jsonc --persist-to "$state/source" --file "$state/seed.sql" > "$state/seed.log" 2>&1 || { cat "$state/seed.log"; echo "FAIL backup-fixture: the synthetic seed did not load; fix test/seed/"; exit 1; }
    node scripts/backup-fixture.ts "$state/source" test/fixtures/backup-recipient.txt test/fixtures/backup.age

restore file identity persist=".wrangler/restore":
    #!/usr/bin/env bash
    set -euo pipefail
    persist="$(./scripts/restore-target.sh {{ quote(persist) }})"
    rm -rf "$persist" && mkdir -p -m 700 "$persist"
    node scripts/restore.ts {{ quote(file) }} {{ quote(identity) }} "$persist/restore.sql"
    just db-migrate --config test/wrangler.test.jsonc --persist-to "$persist" > "$persist/migrate.log" 2>&1 || { cat "$persist/migrate.log"; echo "FAIL restore: migrations did not apply to the fresh D1"; exit 1; }
    npx --no-install wrangler d1 execute tidwick --local --config test/wrangler.test.jsonc --persist-to "$persist" --file "$persist/restore.sql" > "$persist/load.log" 2>&1 || { cat "$persist/load.log"; echo "FAIL restore: the rows did not load; NOT NULL on setting.value_json means the target D1 was not empty, so pass a new target; otherwise the statement wrangler names above shows which table"; exit 1; }
    echo "PASS restore: loaded into the local D1 at $persist"

restore-drill: backup-fixture
    just restore test/fixtures/backup.age test/fixtures/backup-key.txt
    node scripts/restore-drill.ts .wrangler/drill/source .wrangler/restore

lint-sql-boundary:
    ./scripts/sql-boundary.test.sh
    ./scripts/sql-boundary.sh

lint-test-support-gate:
    ./scripts/test-support-gate.test.sh
    ./scripts/test-support-gate.sh

migration-manifest:
    ./scripts/migration-manifest.test.sh
    [ -z "${CI:-}" ] || git fetch --depth=1 origin next:refs/remotes/origin/next
    ./scripts/migration-manifest.sh

lint-import-gate:
    ./scripts/import-gate.test.sh
    ./scripts/import-gate.sh

lint-role-boundary:
    ./scripts/role-boundary.test.sh
    ./scripts/role-boundary.sh

restore-target:
    ./scripts/restore-target.test.sh

restore-errors:
    ./scripts/restore-errors.test.sh

# Deploy, in order: deploy-init, edit wrangler.jsonc (ARCHITECTURE, Deploy), deploy-keys, deploy, deploy-secrets,
# deploy-check, first-admin. `env` is "" for the real deployment or "demo" for wrangler.jsonc env.demo. Nothing here
# prints a secret value. Never run these from a working session against a live account.
[private]
_wr env:
    #!/usr/bin/env bash
    set -euo pipefail
    case {{ quote(env) }} in
      "") echo 'db=tidwick; mig=DB; flags=""' ;;
      demo) echo 'db=tidwick-db; mig=tidwick-db; flags="--config wrangler.jsonc --env demo"' ;;
      *) echo "FAIL deploy: the env is empty or demo, not \"{{ env }}\"" >&2; exit 1 ;;
    esac

deploy-init env="":
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _wr {{ quote(env) }})"
    npx --no-install wrangler login
    npx --no-install wrangler d1 create "$db"
    [ -n "$flags" ] || npx --no-install wrangler r2 bucket create tidwick-backups
    [ -n "$flags" ] || npx --no-install wrangler r2 bucket lifecycle add tidwick-backups expire-old --expire-days 35
    if [ -n "$flags" ]; then echo "NEXT: put the database_id printed above in wrangler.jsonc env.demo, with the other edits in ARCHITECTURE, Deploy"; else echo "NEXT: the database is found by name; make the other edits in ARCHITECTURE, Deploy"; fi

deploy-keys out=".wrangler/kit":
    #!/usr/bin/env bash
    set -euo pipefail
    [ ! -e {{ quote(out) }}/backup-key.txt ] || { echo "FAIL deploy-keys: {{ out }} already holds a kit; move it aside, never overwrite an identity"; exit 1; }
    umask 077
    mkdir -p -m 700 {{ quote(out) }}
    age-keygen -o {{ quote(out) }}/backup-key.txt 2> /dev/null
    age-keygen -y {{ quote(out) }}/backup-key.txt > {{ quote(out) }}/backup-recipient.txt
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > {{ quote(out) }}/session-secret
    openssl rand -base64 32 | tr -d '\n' > {{ quote(out) }}/note-kek
    echo "PASS deploy-keys: backup-key.txt, backup-recipient.txt, session-secret, note-kek in {{ out }}; copy the kit to the owner's offline storage and read it back before any data exists"

deploy-check env="":
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _wr {{ quote(env) }})"
    if [ -n "$flags" ]; then todo='REPLACE_WITH'; skip='NOTE_KEK_PREVIOUS|DEMO_BANNER|BACKUP_S3_'; else todo='example\.com|localhost'; skip='NOTE_KEK_PREVIOUS|DEMO_BANNER'; fi
    if grep -nE "$todo" wrangler.jsonc; then echo "FAIL deploy-check: wrangler.jsonc still holds a placeholder (lines above); edit it as ARCHITECTURE, Deploy says"; exit 1; fi
    have="$(npx --no-install wrangler secret list $flags --format json | grep -oE '"name": *"[A-Z_0-9]+"' | grep -oE '[A-Z_0-9]+"$' | tr -d '"')"
    want="$(grep -oE '^[A-Z_0-9]+=' .dev.vars.example | tr -d '=' | grep -vE "^($skip)")"
    missing="$(comm -23 <(sort <<< "$want") <(sort <<< "$have") | tr '\n' ' ')"
    [ -z "$missing" ] || { echo "FAIL deploy-check: secrets not set on the target: $missing; run just deploy-secrets"; exit 1; }
    echo "PASS deploy-check"

deploy env="":
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _wr {{ quote(env) }})"
    env ${flags:+CLOUDFLARE_ENV=demo} just build
    npx --no-install wrangler deploy ${flags:+--env demo} --dry-run
    npx --no-install wrangler d1 migrations apply "$mig" --remote $flags
    npx --no-install wrangler deploy ${flags:+--env demo}

# Reads each kit file to the secret of that name, then the four off-account lines (endpoint, bucket, key id, secret)
# from standard input, skipped for the demo.
deploy-secrets env="" kit=".wrangler/kit":
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _wr {{ quote(env) }})"
    put() { npx --no-install wrangler secret put "$1" $flags; }
    put SESSION_SECRET < {{ quote(kit) }}/session-secret
    put NOTE_KEK < {{ quote(kit) }}/note-kek
    put BACKUP_RECIPIENT < {{ quote(kit) }}/backup-recipient.txt
    [ -n "$flags" ] || for name in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY_ID BACKUP_S3_SECRET; do
      IFS= read -r value || { echo "FAIL deploy-secrets: standard input ran out before $name"; exit 1; }
      printf '%s' "$value" | put "$name"
    done

first-admin email name firm env="" kit=".wrangler/kit":
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _wr {{ quote(env) }})"
    printf 'SESSION_SECRET=%s\nNOTE_KEK=%s\n' "$(cat {{ quote(kit) }}/session-secret)" "$(cat {{ quote(kit) }}/note-kek)" | just bootstrap {{ quote(email) }} {{ quote(name) }} {{ quote(firm) }}
    npx --no-install wrangler d1 execute "$db" --remote $flags --file .wrangler/bootstrap.sql

# The doc bar as a gate: markdown lives only in the forge face, the agent entry, ARCHITECTURE, the ADRs and the pull request template.
docs-bar:
    #!/usr/bin/env bash
    set -euo pipefail
    extra="$(git ls-files '*.md' | grep -Ev '^(README|CONTRIBUTING|AGENTS|CLAUDE|LICENSE)\.md$|^docs/ARCHITECTURE\.md$|^docs/adr/|^\.github/pull_request_template\.md$' || true)"
    [ -z "$extra" ] || { echo "FAIL docs-bar: $extra; fold it into docs/ARCHITECTURE.md or an ADR and delete it"; exit 1; }
    echo "PASS docs-bar"

colour-literals:
    ./scripts/colour-literals.test.sh
    ./scripts/colour-literals.sh

size:
    ./scripts/size-guard.sh

contrast:
    ./scripts/contrast.test.sh
    node scripts/contrast.ts

# One Node source: mise.toml, mirrored in package.json engines and .node-version.
node-pin:
    #!/usr/bin/env bash
    set -euo pipefail
    want="$(sed -n 's/^node = "\(.*\)"$/\1/p' mise.toml)"
    have="$(node -p 'require("./package.json").engines.node')"
    file="$(tr -d '[:space:]' < .node-version)"
    [ -n "$want" ] && [ "$want" = "$have" ] && [ "$want" = "$file" ] || { echo "FAIL node-pin: mise.toml says '$want', package.json engines says '$have', .node-version says '$file'; make them match"; exit 1; }
    echo "PASS node-pin"

guard: node-pin migration-manifest lint-sql-boundary lint-test-support-gate lint-import-gate lint-role-boundary restore-target restore-errors docs-bar size contrast colour-literals

audit:
    npm audit --audit-level=high

lint-actions:
    actionlint
    zizmor --min-severity medium .github

pin-check:
    pinact run --check

check: typecheck lint lint-actions pin-check fmt-check build test migrate-check restore-drill guard

ci: install check

# --ignore-lock keeps it in the foreground: astro auto-backgrounds under a detected agent, so Playwright sees the server exit.
preview: build
    npx --no-install astro preview --ignore-lock

# The full local suite, both widths. `e2e-smoke` is the CI subset: the specs tagged @smoke, on chromium.
e2e *args:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -e .dev.vars ]; then echo "FAIL e2e: .dev.vars exists; e2e writes its own dummy one, so move yours aside (CI never has one)"; exit 1; fi
    # A run starts on an empty local D1: the fixture's INSERT OR IGNORE rows and enrolment links from an earlier run
    # were made under other random dummy secrets, so they refuse the new links and cannot unwrap the new KEK's keys.
    # The dev D1 is set aside meanwhile and put back on exit (an interrupted run's is put back first).
    state=.wrangler/state
    aside=.wrangler/state.dev
    if [ -e "$aside" ]; then rm -rf "$state"; mv "$aside" "$state"; fi
    if [ -e "$state" ]; then mv "$state" "$aside"; fi
    trap 'rm -f .dev.vars; rm -rf "$state"; if [ -e "$aside" ]; then mv "$aside" "$state"; fi' EXIT
    node test/e2e/prepare.ts
    just db-migrate
    npx --no-install wrangler d1 execute tidwick --local --file .wrangler/e2e.sql
    npx --no-install playwright test {{ args }}

e2e-smoke:
    just e2e --grep @smoke --project=phone

# Writes `version=X` to the step output in CI (stdout elsewhere), as the cache key for the browser download.
playwright-version:
    echo "version=$(npx --no-install playwright --version | awk '{print $2}')" >> "${GITHUB_OUTPUT:-/dev/stdout}"

# The scheduled probe: both public sites answer.
live:
    for url in https://tidwick.dev/ https://demo.tidwick.dev/; do curl -fsS -o /dev/null --retry 4 --retry-delay 15 --retry-all-errors --max-time 30 "$url"; done
