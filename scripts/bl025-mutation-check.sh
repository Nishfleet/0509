#!/usr/bin/env bash
# BL-025 — mutation check for the "stays on the canonical /app" assertions.
#
# The claim under test: the immediate post-submit assertions in
# journey-2-release.spec.ts and local-authenticated.spec.ts REJECT `/app?index`.
#
# The mutation reverts the product fix that produces the canonical URL — the
# setup form goes back to a navigating <Form>, which React Router resolves to
# the index-route action and leaves the browser on `/app?index`. If the
# assertions bite, both specs must FAIL under the mutation and PASS after it is
# reverted. Anything else means the assertions do not test what they claim.
#
#   scripts/bl025-mutation-check.sh mutate | restore | run
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARD="$ROOT/app/components/setup-checklist-card.tsx"

mutate() {
  perl -0pi -e 's{<createFetcher\.Form className="f9-ed-setup-primary" method="post">}{<Form className="f9-ed-setup-primary" method="post">}' "$CARD"
  perl -0pi -e 's{</createFetcher\.Form>}{</Form>}' "$CARD"
  grep -q '<Form className="f9-ed-setup-primary"' "$CARD" || { echo "mutation did not apply"; exit 1; }
  echo "MUTATED: setup form is a navigating <Form> again (post-submit URL becomes /app?index)"
}

restore() {
  perl -0pi -e 's{<Form className="f9-ed-setup-primary" method="post">}{<createFetcher.Form className="f9-ed-setup-primary" method="post">}' "$CARD"
  perl -0pi -e 's{</Form>\n        \) : !hasActionableImportPreview}{</createFetcher.Form>\n        ) : !hasActionableImportPreview}' "$CARD"
  grep -q '<createFetcher.Form className="f9-ed-setup-primary"' "$CARD" || { echo "restore did not apply"; exit 1; }
  grep -q '</createFetcher.Form>' "$CARD" || { echo "restore did not close the fetcher form"; exit 1; }
  echo "RESTORED: setup form is a fetcher again (post-submit URL is /app)"
}

run() {
  cd "$ROOT"
  local release_status=0 auth_status=0
  E2E_START_LOCAL_SERVER=1 ./node_modules/.bin/playwright test \
    --config=playwright.config.ts --project=local-release \
    --grep "persistent setup card keeps an empty free workspace honest" \
    > /tmp/bl025-mut-release.log 2>&1 || release_status=$?
  E2E_START_LOCAL_SERVER=1 ./node_modules/.bin/playwright test \
    --config=playwright.config.ts --project=local-auth \
    --grep "new customer sees setup inside Overview" \
    > /tmp/bl025-mut-auth.log 2>&1 || auth_status=$?
  echo "journey-2 (local-release) exit=$release_status : $(grep -E '^  [0-9]+ (passed|failed)' /tmp/bl025-mut-release.log | tr '\n' ' ')"
  echo "local-auth              exit=$auth_status : $(grep -E '^  [0-9]+ (passed|failed)' /tmp/bl025-mut-auth.log | tr '\n' ' ')"
}

case "${1:-}" in
  mutate) mutate ;;
  restore) restore ;;
  run) run ;;
  *) echo "usage: $0 mutate|restore|run" >&2; exit 2 ;;
esac
