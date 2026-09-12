#!/usr/bin/env bash
# Regression canary for issue #1283: sitemap-vs-noindex parity.
#
# Every /ads/:domain URL listed in the production sitemap must be served
# WITHOUT a `<meta name="robots" content="noindex">` tag. If a page is listed
# in the sitemap but serves noindex, Google distrusts both the list and the
# page, and the whole programmatic SEO surface goes dark.
#
# This is the mechanical-fix guard (fleet-ops#366) for a bug that was closed and
# re-emerged three times (#912, #1071, #1120, #1142). It fails closed: any
# sitemap /ads page that serves noindex exits non-zero.
#
# NOTE: we match the actual `<meta name="robots" content="noindex">` tag, NOT
# the bare word "noindex". The word appears inside the Remix loader-data JSON
# blob on every page regardless of indexing state, so a naive `grep -c noindex`
# reports a false positive on every page (the issue's own verify snippet did
# exactly that). The tag is the only signal that actually controls indexing.
set -euo pipefail

SITE="${SEO_PARITY_SITE:-https://0509.io}"
SITEMAP_URL="${SITE}/sitemap.xml"
# Sample up to this many /ads URLs so the PR check stays fast and bounded.
MAX_SAMPLE="${SEO_PARITY_MAX_SAMPLE:-10}"
# Optional canary-bearer header (issue #3278). When set, every curl below
# sends it; the public-brand-page edge limiter returns null for an
# authenticated canary request, so the canary can sweep the whole sitemap
# in one run without tripping the very limiter it is supposed to be
# measuring. Unset on local PR checks (the limiter is generous in CI and a
# one-off local sample never trips it). Constant-time-compare is at the edge
# limiter; this script only sets the header.
# NOTE (issue #3278 investigation, 2026-09-12): the nine sitemap /ads URLs
# that showed HTTP 301 in that issue's local repro (zivame.com, snitch.co.in,
# kamaayurveda.com, dotandkey.com, thedermaco.com, newbalance.com, hoka.com,
# mailchimp.com, nykaa.com) were the loader's transient cache-miss redirect
# (#1282) and live-verified as HTTP 200 + indexable the same day. Nothing was
# changed against them: the existing --retry-followed curl detects a
# redirected URL as a non-2xx FAIL the moment one re-appears, and
# tests/sitemap-ads-no-redirect.test.ts pins generator-vs-loader agreement at
# the unit level.
CURL_OPTS=(--silent --show-error --max-time 20 --retry 2 --retry-delay 2)
if [ -n "${SEO_PARITY_CANARY_TOKEN:-}" ]; then
  CURL_OPTS+=(-H "x-0509-canary-token: ${SEO_PARITY_CANARY_TOKEN}")
fi

# 1. Fetch the sitemap and extract the /ads/:domain URLs it lists.
sitemap="$(curl "${CURL_OPTS[@]}" "$SITEMAP_URL")"
ads_urls=()
while IFS= read -r url; do
  ads_urls+=("$url")
done < <(printf '%s\n' "$sitemap" \
  | grep -oE '<loc>https://0509.io/ads/[^<]+</loc>' \
  | sed -E 's#</?loc>##g' || true)

if [ "${#ads_urls[@]}" -eq 0 ]; then
  echo "seo-parity: FAIL — sitemap listed no /ads/:domain URLs (sitemap fetch or parse broken?)" >&2
  exit 1
fi

echo "seo-parity: sitemap lists ${#ads_urls[@]} /ads URLs; sampling up to ${MAX_SAMPLE}"

failures=0
for url in "${ads_urls[@]:0:${MAX_SAMPLE}}"; do
  body_file="$(mktemp)"
  http_code="$(curl "${CURL_OPTS[@]}" --write-out '%{http_code}' --output "$body_file" "$url" || true)"
  body="$(cat "$body_file")"
  rm -f "$body_file"
  # Fail loud on a non-2xx status or an empty body: a page that errors (5xx)
  # or returns nothing might carry no noindex meta and would otherwise be
  # reported as "ok — indexable", silently green in a canary whose whole job
  # is to fail loud on a broken surface (issue #1455 acceptance #2). The
  # tagless/empty shape proves nothing about indexability.
  if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ] || [ -z "$body" ]; then
    echo "seo-parity: FAIL — ${url} returned HTTP ${http_code} (${#body} bytes)" >&2
    failures=$((failures + 1))
  elif printf '%s\n' "$body" | grep -q '<meta name="robots" content="noindex">'; then
    echo "seo-parity: FAIL — ${url} serves <meta name=\"robots\" content=\"noindex\">" >&2
    failures=$((failures + 1))
  else
    echo "seo-parity: ok — ${url} is indexable (HTTP ${http_code})"
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "seo-parity: FAIL — ${failures} sitemap /ads URL(s) failed the indexable check (non-2xx/empty body/noindex)" >&2
fi

# 2. Fixture-vs-live drift alarm (issue #3229).
#
# Sections in this script ACCUMULATE failures and exit once at the end —
# never bail early. A hard failure in the noindex loop above (e.g. live
# 429s, as seen 2026-09-12 when the sitemap grew past the rate limit) must
# not mask the drift gate: drift is exactly what accumulates while another
# section is red.
#
# The /brands and /sneaker-resale coverage tests pin the cluster's live,
# indexable /ads/ domains to a hand-updated snapshot
# (tests/fixtures/sneaker-resale-indexable-domains.snapshot.json). Between
# snapshot refreshes the cluster keeps scaling — a new sitemap /ads domain
# silently falls out of the hub array (and into the "More brands" fallback
# bucket on /brands) with nothing failing. This already happened once
# (114 -> 119 domains, fleet of new cluster pages shipped with no alarm).
#
# The same daily live fetch that powers the noindex parity loop above now
# also diffs the live sitemap /ads set against the snapshot, in BOTH
# directions, and fails loud on either kind of drift:
#   - live sitemap /ads domain that IS a sneaker-resale seed-list cluster
#     domain but is MISSING from the snapshot (the silent fallback: the hub
#     array and the fixture never learned about it), or
#   - snapshot domain that has DROPPED OUT of the live sitemap (stale
#     snapshot: the hub would ship a dead /ads link the sitemap no longer
#     backs).
#
# Cluster membership uses the seed list (data/seed-lists/sneaker-resale.json)
# — the snapshot is the indexable filter applied to it, never a license to
# fail on unrelated non-cluster /ads domains the product publishes.

drift_failures=0
# Force byte-order collation for every sort/comm in this section: sort's
# last-resort tie-breaking and comm's strcoll comparison can disagree under
# a UTF-8 locale (e.g. on saucony.co.uk vs saucony.com), silently corrupting
# the set diff. LC_ALL=C makes sort and comm agree, on any runner.
LC_ALL=C
export LC_ALL
# `|| true` inside the substitution: a missing/malformed fixture or seed list
# must reach the fail-closed branch below (drift_failures=1, sections keep
# running) — under `set -euo pipefail` a failing jq would otherwise abort the
# script silently before the message and skip the remaining sections.
fixture_raw="$(jq -r '.domains[]' tests/fixtures/sneaker-resale-indexable-domains.snapshot.json 2>/dev/null || true)"
seed_raw="$(jq -r '.domains[].domain' data/seed-lists/sneaker-resale.json 2>/dev/null || true)"
# sort -u everywhere: comm treats an unpaired duplicate as a set difference,
# so a duplicated sitemap <loc> would page a false drift alarm.
fixture_domains="$(printf '%s\n' "$fixture_raw" | tr 'A-Z' 'a-z' | sed 's#^www\.##' | sort -u)"
seed_domains="$(printf '%s\n' "$seed_raw" | tr 'A-Z' 'a-z' | sed 's#^www\.##' | sort -u)"

if [ -z "$fixture_domains" ] || [ -z "$seed_domains" ]; then
  echo "seo-parity: FAIL — could not read the sitemap snapshot fixture or the sneaker-resale seed list; drift gate blind, failing closed" >&2
  drift_failures=$((drift_failures + 1))
else
  # sitemap-derived /ads/:domain hostnames, normalized the same way the
  # brand-page route normalizes its :domain param for registry lookups
  # (lowercase, www. stripped).
  live_cluster="$(printf '%s\n' "${ads_urls[@]}" \
    | sed -E 's#https://0509\.io/ads/##; s#/.*##' \
    | tr 'A-Z' 'a-z' | sed 's#^www\.##' | sort -u \
    | comm -12 - <(printf '%s\n' "$seed_domains"))"
  missing_from_fixture="$(printf '%s\n' "$live_cluster" | comm -23 - <(printf '%s\n' "$fixture_domains"))" # in live (file1) but NOT in fixture (suppress col2+col3)
  stale_in_fixture="$(printf '%s\n' "$fixture_domains" | comm -23 - <(printf '%s\n' "${ads_urls[@]}" | sed -E 's#https://0509\.io/ads/##; s#/.*##' | tr 'A-Z' 'a-z' | sed 's#^www\.##' | sort -u))" # in fixture (file1) but NOT live (col1 only)

  if [ -n "$missing_from_fixture" ]; then
    echo "seo-parity: FAIL — sneaker-resale cluster drift: these seed-list domains are listed in the production sitemap (indexability itself is asserted by the section above) but missing from tests/fixtures/sneaker-resale-indexable-domains.snapshot.json (silent /brands 'More brands' + hub-array omission):" >&2
    printf 'seo-parity:   %s\n' $missing_from_fixture >&2
    echo "seo-parity:       -> refresh the snapshot fixture AND SNEAKER_RESALE_BRAND_PAGES (app/components/sneaker-resale-landing.tsx) together." >&2
    drift_failures=$((drift_failures + 1))
  fi
  if [ -n "$stale_in_fixture" ]; then
    echo "seo-parity: FAIL — sneaker-resale cluster drift: these fixture domains are NO LONGER listed in the production sitemap (stale snapshot; the hub would ship dead /ads links):" >&2
    printf 'seo-parity:   %s\n' $stale_in_fixture >&2
    echo "seo-parity:       -> remove them from the snapshot fixture AND SNEAKER_RESALE_BRAND_PAGES together." >&2
    drift_failures=$((drift_failures + 1))
  fi
  if [ "$drift_failures" -eq 0 ]; then
    echo "seo-parity: ok — sitemap snapshot fixture matches the live sneaker-resale cluster /ads set"
  fi
fi

if [ "$drift_failures" -gt 0 ]; then
  echo "seo-parity: FAIL — ${drift_failures} snapshot-fixture drift finding(s)" >&2
fi

# 3. Live-prod check for the BET 8 MagicBrief wind-down surface (issue #3111).
#
# Regression it guards: /switch/magicbrief is the one named-vendor shutdown
# creating real switching demand, but it re-emerged as a 301 to the bare
# /compare hub (which never mentions MagicBrief), and the sitemap listed
# neither /switch/magicbrief nor /compare/magicbrief. The unit tests and
# route-registration assertions caught nothing because the code on main was
# correct — only the deployed surface was wrong. This check hits production,
# exactly like the /ads parity loop above:
#
#   /switch/magicbrief (following any 301) must resolve to a 200 page whose
#   served HTML contains "magicbrief" case-insensitively, and that final 200
#   URL must be listed in sitemap.xml. The bare /compare hub is NOT an
#   acceptable landing for the trigger.
body_file="$(mktemp)"
# touch first: a connection-refused curl never creates the --output file,
# and the cat below must see an empty body, not ENOENT (set -euo pipefail).
touch "$body_file"
meta="$(curl "${CURL_OPTS[@]}" --location --max-redirs 4 --output "$body_file" --write-out 'META %{http_code} %{url_effective}' "$SITE/switch/magicbrief" 2>/dev/null || true)"
switch_http_code="$(printf '%s\n' "$meta" | sed -n 's/^META \([0-9]*\).*/\1/p' | tail -1)"
effective_url="$(printf '%s\n' "$meta" | sed -n 's/^META [0-9]* *//p' | tail -1)"
switch_body="$(cat "$body_file")"
rm -f "$body_file"

magicbrief_failures=0
if [ "$switch_http_code" -lt 200 ] || [ "$switch_http_code" -ge 300 ] || [ -z "$switch_body" ]; then
  echo "seo-parity: FAIL — /switch/magicbrief resolved to HTTP ${switch_http_code} (${#switch_body} bytes at ${effective_url})" >&2
  magicbrief_failures=$((magicbrief_failures + 1))
elif ! printf '%s\n' "$switch_body" | grep -qi 'magicbrief'; then
  echo "seo-parity: FAIL — ${effective_url} (HTTP ${switch_http_code}) never mentions MagicBrief" >&2
  magicbrief_failures=$((magicbrief_failures + 1))
elif ! printf '%s\n' "$sitemap" | grep -qF "${effective_url}"; then
  echo "seo-parity: FAIL — canonical ${effective_url} is not listed in sitemap.xml" >&2
  magicbrief_failures=$((magicbrief_failures + 1))
fi

if [ "$magicbrief_failures" -gt 0 ]; then
  echo "seo-parity: FAIL — ${magicbrief_failures} MagicBrief wind-down check(s) failed" >&2
fi

total_failures=$((failures + drift_failures + magicbrief_failures))
if [ "$total_failures" -gt 0 ]; then
  echo "seo-parity: FAIL — ${total_failures} finding(s): ${failures} indexable-check, ${drift_failures} fixture-drift, ${magicbrief_failures} magicbrief" >&2
  exit 1
fi

echo "seo-parity: PASS — all sampled sitemap /ads URLs are indexable; the snapshot fixture matches the live cluster /ads set; /switch/magicbrief is a 200 MagicBrief page listed in the sitemap (${effective_url})"
