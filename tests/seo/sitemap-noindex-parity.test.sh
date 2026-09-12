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
CURL_OPTS=(--silent --show-error --max-time 20 --retry 2 --retry-delay 2)

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
  echo "seo-parity: FAIL — ${failures} sitemap /ads URL(s) serve noindex" >&2
  exit 1
fi

# 2. Live-prod check for the BET 8 MagicBrief wind-down surface (issue #3111).
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
  exit 1
fi

echo "seo-parity: PASS — all sampled sitemap /ads URLs are indexable; /switch/magicbrief is a 200 MagicBrief page listed in the sitemap (${effective_url})"
