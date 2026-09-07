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
  body="$(curl "${CURL_OPTS[@]}" "$url")"
  if printf '%s\n' "$body" | grep -q '<meta name="robots" content="noindex">'; then
    echo "seo-parity: FAIL — ${url} serves <meta name=\"robots\" content=\"noindex\">" >&2
    failures=$((failures + 1))
  else
    echo "seo-parity: ok — ${url} is indexable"
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "seo-parity: FAIL — ${failures} sitemap /ads URL(s) serve noindex" >&2
  exit 1
fi

echo "seo-parity: PASS — all sampled sitemap /ads URLs are indexable"
