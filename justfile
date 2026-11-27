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

build:
    npx --no-install wrangler types
    npx --no-install astro build

# The Worker bundles and wrangler accepts the config, as deploy would, before anything merges. No token needed.
dry-run: build
    npx --no-install wrangler deploy --dry-run --outdir "$(mktemp -d)"

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
    # A deploy applies new migrations to a populated database, so the later ones must also pass over rows (a person holds a foreign key into firm).
    keep="$(mktemp -d)"
    trap 'rm -rf "$state" "$keep"' EXIT
    run() { npx --no-install wrangler d1 execute tidwick --local --persist-to "$keep" "$@"; }
    run --file migrations/0001_init.sql > "$keep/apply.log" 2>&1 || { cat "$keep/apply.log"; echo "FAIL migrate-populated: 0001 did not apply; see above"; exit 1; }
    run --command "INSERT INTO client (id, name, created_at) VALUES ('c1', 'Acme', 0); INSERT INTO firm (id, client_id) VALUES ('f1', 'c1'); INSERT INTO person (id, firm_id, email, name, created_at) VALUES ('p1', 'f1', 'a@example.test', 'A', 0);" >> "$keep/apply.log" 2>&1 || { cat "$keep/apply.log"; echo "FAIL migrate-populated: the 0001 seed rows did not insert; fix the INSERTs in the justfile"; exit 1; }
    for f in $(ls migrations/*.sql | sort | tail -n +2); do
      run --file "$f" >> "$keep/apply.log" 2>&1 || { cat "$keep/apply.log"; echo "FAIL migrate-populated: $f cannot apply over existing rows; rebuild tables so rows survive foreign keys"; exit 1; }
    done
    echo "PASS migrate-populated"

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

# `local` is the local dev D1; `remote` is the deployed demo's D1 from wrangler.jsonc env.demo, with the demo
# Worker's NOTE_KEK=... line on standard input. Drops every table first, audit log included, then migrates and
# loads the demo seed.
demo-reset target="local":
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
      *) echo "FAIL demo-reset: the target is local or remote, not \"{{ target }}\""; exit 1 ;;
    esac
    node scripts/seed-demo.ts --drop > .wrangler/demo-drop.sql
    npx --no-install wrangler d1 execute "${db[@]}" --file .wrangler/demo-drop.sql >> "$log" 2>&1 || { tail -n 40 "$log"; echo "FAIL demo-reset: the tables did not drop; the statement wrangler names above is in test/demo/reset.ts"; exit 1; }
    npx --no-install wrangler d1 migrations apply "${db[@]}" --force >> "$log" 2>&1 || { tail -n 40 "$log"; echo "FAIL demo-reset: migrations did not apply to the {{ target }} D1; fix the SQL named above"; exit 1; }
    npx --no-install wrangler d1 execute "${db[@]}" --file .wrangler/demo.sql >> "$log" 2>&1 || { tail -n 40 "$log"; echo "FAIL demo-reset: the demo seed did not load; the statement wrangler names above is built in test/demo/"; exit 1; }
    echo "PASS demo-reset ({{ target }}): 2 invented firms, 25 people, 12 projects and thirteen weeks of time in the {{ target }} D1; wrangler output in $log"

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

rescue person seq hash out=".wrangler/rescue.sql" *flags:
    mkdir -p "$(dirname {{ quote(out) }})"
    node scripts/rescue.ts {{ quote(person) }} {{ quote(seq) }} {{ quote(hash) }} {{ quote(out) }} {{ flags }}

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
    npx --no-install wrangler d1 execute tidwick --local --config test/wrangler.test.jsonc --persist-to "$state/source" --file test/seed/hostile.sql >> "$state/seed.log" 2>&1 || { cat "$state/seed.log"; echo "FAIL backup-fixture: the hostile-text rows did not load; fix test/seed/hostile.sql"; exit 1; }
    node scripts/backup-fixture.ts "$state/source" test/fixtures/backup-recipient.txt test/fixtures/backup.age

restore file identity head persist=".wrangler/restore":
    #!/usr/bin/env bash
    set -euo pipefail
    persist="$(./scripts/restore-target.sh {{ quote(persist) }})"
    rm -rf "$persist" && mkdir -p -m 700 "$persist"
    node scripts/restore.ts {{ quote(file) }} {{ quote(identity) }} "$persist/restore.sql" {{ quote(head) }}
    just db-migrate --config test/wrangler.test.jsonc --persist-to "$persist" > "$persist/migrate.log" 2>&1 || { cat "$persist/migrate.log"; echo "FAIL restore: migrations did not apply to the fresh D1"; exit 1; }
    npx --no-install wrangler d1 execute tidwick --local --config test/wrangler.test.jsonc --persist-to "$persist" --file "$persist/restore.sql" > "$persist/load.log" 2>&1 || { cat "$persist/load.log"; echo "FAIL restore: the rows did not load; NOT NULL on setting.value_json means the target D1 was not empty, so pass a new target; otherwise the statement wrangler names above shows which table"; exit 1; }
    echo "PASS restore: loaded into the local D1 at $persist"

# Fetches one sealed backup from the Worker account's R2 bucket. Pass YYYY-MM-DD for a nightly run (its key ends
# -030000, the cron instant), or YYYY-MM-DD-HHMMSS (UTC) for an on-demand one (backups/YYYY/MM/DD-HHMMSS.ndjson.gz.age).
backup-fetch night out=".wrangler/restore-remote/backup.age":
    #!/usr/bin/env bash
    set -euo pipefail
    night={{ quote(night) }}
    [[ "$night" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && night="$night-030000"
    [[ "$night" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}$ ]] || { echo "FAIL backup-fetch: pass YYYY-MM-DD (nightly) or YYYY-MM-DD-HHMMSS (UTC, on-demand), not {{ quote(night) }}"; exit 1; }
    mkdir -p -m 700 "$(dirname {{ quote(out) }})"
    npx --no-install wrangler r2 object get "tidwick-backups/backups/$(echo "$night" | sed 's#-#/#; s#-#/#').ndjson.gz.age" --remote --file {{ quote(out) }} || { echo "FAIL backup-fetch: no such object; nightly keys end -030000, an on-demand time needs the full HHMMSS; ARCHITECTURE, Operate, Restore, shows the off-account fetch"; exit 1; }
    echo "PASS backup-fetch: {{ out }}; next: just restore-remote {{ out }} <the age identity file from the offline kit> <the seq:hash:digest value you recorded for this backup>"

# Loads a backup into the deployed database of the same name: migrate, then the rows. For a lost database: create
# it first (`wrangler d1 create tidwick`), run this BEFORE `just deploy`, then follow ARCHITECTURE, Operate, Restore.
# The first statement fails on a database that already holds rows, so a live one is never overwritten.
restore-remote file identity head env="":
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _wr {{ quote(env) }})"
    dir=.wrangler/restore-remote
    rm -rf "$dir/restore.sql" && mkdir -p -m 700 "$dir"
    node scripts/restore.ts {{ quote(file) }} {{ quote(identity) }} "$dir/restore.sql" {{ quote(head) }}
    npx --no-install wrangler d1 migrations apply "$mig" --remote $flags || { echo "FAIL restore-remote: migrations did not apply; check the database exists (wrangler d1 list) and wrangler is logged in to the right account"; exit 1; }
    npx --no-install wrangler d1 execute "$db" --remote $flags --file "$dir/restore.sql" || { echo "FAIL restore-remote: the rows did not load; NOT NULL on setting.value_json means the database was not empty: create a new one and start again"; exit 1; }
    echo "PASS restore-remote: loaded into $db; delete $dir/restore.sql, then the post-restore steps in ARCHITECTURE, Operate, Restore"

# The backup size estimate against the live database, as a percentage of the cap (ARCHITECTURE, Operate).
backup-size env="":
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _wr {{ quote(env) }})"
    npx --no-install wrangler d1 execute "$db" --remote $flags --command "$(node scripts/backup-size.ts)"

# Probes the off-account bucket with its key (src/backup/offsite-probe.ts); the four BACKUP_S3 lines on standard input.
offsite-check:
    node scripts/offsite-check.ts

restore-drill: backup-fixture
    just restore test/fixtures/backup.age test/fixtures/backup-key.txt "$(cat test/fixtures/backup.age.head)"
    node scripts/restore-drill.ts .wrangler/drill/source .wrangler/restore

# Deploy recipes; the order is in ARCHITECTURE, Deploy. `env` is "" for the real deployment or "demo" for
# wrangler.jsonc env.demo. Nothing here prints a secret value.
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

# The deploy kit (session secret, note key, backup recipient) goes in `out`; the backup decryption identity goes alone in `identity`,
# a directory the owner moves to offline storage, so the deploying machine need not keep it.
deploy-keys out=".wrangler/kit" identity=".wrangler/offline-key":
    #!/usr/bin/env bash
    set -euo pipefail
    for held in {{ quote(out) }}/backup-recipient.txt {{ quote(identity) }}/backup-key.txt; do
      [ ! -e "$held" ] || { echo "FAIL deploy-keys: $held exists; move the kit and identity aside, never overwrite a key"; exit 1; }
    done
    umask 077
    mkdir -p -m 700 {{ quote(out) }} {{ quote(identity) }}
    age-keygen -o {{ quote(identity) }}/backup-key.txt 2> /dev/null
    age-keygen -y {{ quote(identity) }}/backup-key.txt > {{ quote(out) }}/backup-recipient.txt
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > {{ quote(out) }}/session-secret
    openssl rand -base64 32 | tr -d '\n' > {{ quote(out) }}/note-kek
    echo "PASS deploy-keys: backup-recipient.txt, session-secret, note-kek in {{ out }}; the backup decryption identity is {{ identity }}/backup-key.txt: move it to the owner's offline storage, read it back, then delete {{ identity }}; copy the kit too"

deploy-check env="":
    ./scripts/deploy-check.sh {{ env }}

deploy env="":
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _wr {{ quote(env) }})"
    env ${flags:+CLOUDFLARE_ENV=demo} just build
    npx --no-install wrangler deploy ${flags:+--env demo} --dry-run
    # Pre-release only: a demo that ran an older 0001_init.sql is reset first (scripts/demo-schema-sync.sh); never any other database.
    if [ -n "$flags" ]; then ./scripts/demo-schema-sync.sh "$mig" $flags; fi
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

# Bump the version on a branch, for a PR to next. Never pushes, tags or merges; it prints the rest.
release version:
    #!/usr/bin/env bash
    set -euo pipefail
    [[ "{{ version }}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "FAIL release: pass X.Y.Z, not {{ version }}"; exit 1; }
    branch="$(git branch --show-current)"
    case "$branch" in main|next|"") echo "FAIL release: switch to a branch for the bump PR, not '$branch'"; exit 1;; esac
    [ -z "$(git status --porcelain)" ] || { echo "FAIL release: the tree is not clean"; exit 1; }
    grep -q '^## \[{{ version }}\]' CHANGELOG.md || { echo "FAIL release: CHANGELOG.md has no '## [{{ version }}]' section; add it in the bump PR"; exit 1; }
    npm version "{{ version }}" --no-git-tag-version >/dev/null
    echo "PASS release: package.json and the lockfile say {{ version }}; commit them and open a PR to next; after the merge: fast-forward main, run the lab checklist in docs/ARCHITECTURE.md, Deploy, then tag"
    echo "CHANGELOG.md says:"
    sed -n '/^## \[{{ version }}\]/,/^## \[/p' CHANGELOG.md | sed '$ {/^## \[/d;}'
    echo "NEXT, by hand once the PR is merged (the lab runs between the two steps):"
    echo "  git fetch origin && git push origin origin/next:main"
    echo "  (run the lab checklist against main)"
    echo "  git fetch origin && git tag -a v{{ version }} -m v{{ version }} origin/main && git push origin v{{ version }}"

# The checks ESLint cannot see (docs/ARCHITECTURE.md §8). Each prints one PASS or FAIL line.
guard:
    #!/usr/bin/env bash
    set -euo pipefail
    extra="$(git ls-files '*.md' | grep -Ev '^(README|CONTRIBUTING|AGENTS|CLAUDE|LICENSE|SECURITY|CHANGELOG)\.md$|^docs/ARCHITECTURE\.md$|^docs/adr/|^\.github/pull_request_template\.md$' || true)"
    [ -z "$extra" ] || { echo "FAIL docs-bar: $extra; fold it into docs/ARCHITECTURE.md or an ADR and delete it"; exit 1; }
    echo "PASS docs-bar"
    ./scripts/migrations-guard.test.sh
    ./scripts/migrations-guard.sh
    ./scripts/restore-target.test.sh
    ./scripts/restore-errors.test.sh
    ./scripts/deploy-check.test.sh
    ./scripts/deploy-keys.test.sh
    ./scripts/demo-schema-sync.test.sh
    ./scripts/size-guard.sh
    ./scripts/colour-literals.test.sh
    ./scripts/colour-literals.sh
    ./scripts/contrast.test.sh
    node scripts/contrast.ts

audit:
    npm audit --audit-level=high

lint-actions:
    actionlint
    zizmor --min-severity medium .github

check: typecheck lint lint-actions fmt-check build dry-run test migrate-check restore-drill guard

ci: install check

# --ignore-lock keeps it in the foreground: astro auto-backgrounds under a detected agent, so Playwright sees the server exit.
preview: build
    npx --no-install astro preview --ignore-lock

# The full local suite, both widths; CI runs it the same way.
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
    # Three fresh-instance phases first, each on an empty D1: no secrets (`/setup` makes them), a setup token (`/setup` claims), and MCP off.
    fresh() { rm -rf "$state"; just db-migrate; FRESH=$1 npx --no-install playwright test --project=phone; }
    fresh setup
    node test/e2e/prepare.ts
    export SETUP_TOKEN=e2e-setup-token-0123456789-abcdefghijklmnopqrstuvwxyz
    echo "SETUP_TOKEN=$SETUP_TOKEN" >> .dev.vars
    fresh claim
    unset SETUP_TOKEN
    # Then the same secrets with the agent surface left off (the generated .dev.vars turns it on).
    grep -v -e '^MCP=on$' -e '^SETUP_TOKEN=' .dev.vars > .dev.vars.off
    cat .dev.vars.off > .dev.vars
    rm .dev.vars.off
    fresh off
    rm -rf "$state"
    node test/e2e/prepare.ts
    just db-migrate
    npx --no-install wrangler d1 execute tidwick --local --file .wrangler/e2e.sql
    npx --no-install playwright test {{ args }}

# Writes `version=X` to the step output in CI (stdout elsewhere), as the cache key for the browser download.
playwright-version:
    echo "version=$(npx --no-install playwright --version | awk '{print $2}')" >> "${GITHUB_OUTPUT:-/dev/stdout}"

# The deployed sites answer as the code says they do, GET only: the demo's sign-in is open, /login carries its CSP and a
# hashed script that loads, /week sends a signed-out visitor to sign in, /mcp, /oauth and the well-known routes and /setup do not exist there (MCP is off), and the project site is up.
live:
    #!/usr/bin/env bash
    set -euo pipefail
    demo=https://demo.tidwick.dev
    get() { curl -sS --retry 4 --retry-delay 15 --retry-all-errors --max-time 30 -o "$1" -D "$1.h" -w '%{http_code}' "$2"; }
    t="$(mktemp -d)"
    want() { [ "$2" = "$3" ] || { echo "FAIL live: $1 answered $2, expected $3"; exit 1; }; }
    want /demo "$(get "$t/demo" $demo/demo)" 200
    grep -q 'Pick a person' "$t/demo" || { echo "FAIL live: /demo lacks \"Pick a person\""; exit 1; }
    want /login "$(get "$t/login" $demo/login)" 200
    grep -qi '^content-security-policy:' "$t/login.h" || { echo "FAIL live: /login sends no content-security-policy"; exit 1; }
    script="$(grep -o 'src="/_astro/[^"]*\.js"' "$t/login" | head -1 | cut -d'"' -f2)"
    [ -n "$script" ] || { echo "FAIL live: /login names no hashed script"; exit 1; }
    want "$script" "$(get "$t/js" "$demo$script")" 200
    want /week "$(get "$t/week" $demo/week)" 303
    grep -qi '^location: /login?return=%2Fweek' "$t/week.h" || { echo "FAIL live: /week does not send a signed-out visitor to /login?return=%2Fweek"; exit 1; }
    want /mcp "$(get "$t/mcp" $demo/mcp)" 404
    want /.well-known/oauth-protected-resource "$(get "$t/prm" $demo/.well-known/oauth-protected-resource)" 404
    want /oauth/authorize "$(get "$t/authorize" $demo/oauth/authorize)" 404
    want /oauth/token "$(get "$t/token" $demo/oauth/token)" 404
    want /.well-known/oauth-authorization-server "$(get "$t/asm" $demo/.well-known/oauth-authorization-server)" 404
    want /setup "$(get "$t/setup" $demo/setup)" 404
    want tidwick.dev "$(get "$t/site" https://tidwick.dev/)" 200
    echo "PASS live"
