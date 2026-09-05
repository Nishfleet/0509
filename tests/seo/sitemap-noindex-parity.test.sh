#!/usr/bin/env bash
# tests/seo/sitemap-noindex-parity.test.sh
#
# Production canary for issue #1283: every /ads/:domain URL listed in the
# production sitemap must serve an indexable page — no
#   <meta name="robots" content="noindex">
# tag in the HTML body and no
#   x-robots-tag: noindex
# HTTP header. Sitemap membership and noindex state must agree, or Google
# treats the sitemap as untrustworthy and the programmatic acquisition
# channel goes dark.
#
# This is the prevention mechanism (mechanical-fix rule, fleet-ops#366) for
# the third recurrence of the sitemap-vs-noindex drift bug (#912, #1071,
# #1283). The code-level parity between sitemap.server.ts and the
# /ads/:domain loader is unit-tested in tests/sitemap.server.test.ts; this
# canary catches the failure mode those unit tests CANNOT see: a production
# environment change (e.g. PUBLIC_BRAND_PAGES_INDEXABLE flipped in the
# Cloudflare dashboard) that re-introduces noindex on sitemap-listed pages
# without any code change.
#
# IMPORTANT: the check looks for the ACTUAL noindex signals — the meta tag
# and the HTTP header — NOT the bare string "noindex". The React Router
# streaming response always contains the loader-data key "noindex" (a
# boolean field name) regardless of whether the page is indexable, so a
# bare `grep -c noindex` is a false positive on every /ads page. The
# original issue's verify command used that bare grep and was wrong.
#
# Exits 0 when every sitemap /ads/:domain URL is indexable, 1 on any
# noindex hit or unrecoverable fetch failure (fails closed).
#
# Usage:
#   bash tests/seo/sitemap-noindex-parity.test.sh
#   bash tests/seo/sitemap-noindex-parity.test.sh --base-url https://0509.io
#   bash tests/seo/sitemap-noindex-parity.test.sh --max-domains 10
#
# Environment overrides:
#   SEO_PARITY_BASE_URL    — base URL (default https://0509.io)
#   SEO_PARITY_MAX_DOMAINS — cap on /ads URLs to check (default 50; 0 = all)
#   SEO_PARITY_TIMEOUT     — per-request curl timeout in seconds (default 15)
#   SEO_PARITY_DELAY       — seconds to sleep between requests (default 1;
#                            production rate-limits rapid sequential curls)
#   SEO_PARITY_RETRIES     — retries on HTTP 429 before failing (default 2)

set -euo pipefail

BASE_URL="${SEO_PARITY_BASE_URL:-https://0509.io}"
MAX_DOMAINS="${SEO_PARITY_MAX_DOMAINS:-50}"
TIMEOUT="${SEO_PARITY_TIMEOUT:-15}"
DELAY="${SEO_PARITY_DELAY:-1}"
RETRIES="${SEO_PARITY_RETRIES:-2}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --max-domains) MAX_DOMAINS="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

SITEMAP_URL="${BASE_URL}/sitemap.xml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

log() {
  echo "[seo-parity] $*"
}

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v grep >/dev/null 2>&1 || fail "grep is required"

#
# 1. Fetch the sitemap and extract /ads/:domain URLs.
#
log "fetching sitemap: ${SITEMAP_URL}"
sitemap_xml=$(curl -sS --max-time "${TIMEOUT}" -f "${SITEMAP_URL}" 2>/dev/null) \
  || fail "could not fetch sitemap from ${SITEMAP_URL}"

# Extract the domain from each <loc>https://0509.io/ads/:domain</loc> entry.
# The sitemap is XML; grep -oE is sufficient for the well-formed loc tags this
# repo's buildSitemapXml emits (verified in tests/sitemap.server.test.ts).
ads_domains=$(printf '%s\n' "${sitemap_xml}" \
  | grep -oE '<loc>[^<]*//[^<]*/ads/[^<]+</loc>' \
  | sed -E 's|.*<loc>[^<]*/ads/||; s|</loc>||' \
  | sort -u)

ads_count=$(printf '%s\n' "${ads_domains}" | grep -c . || true)
if [[ "${ads_count}" -eq 0 ]]; then
  fail "sitemap contains zero /ads/:domain URLs — the programmatic SEO surface is empty (scope regression)"
fi
log "sitemap lists ${ads_count} /ads/:domain URL(s)"

#
# 2. Cap the sample if --max-domains is set (>0).
#
checked=0
if [[ "${MAX_DOMAINS}" -gt 0 && "${ads_count}" -gt "${MAX_DOMAINS}" ]]; then
  log "capping check to first ${MAX_DOMAINS} URL(s) (set SEO_PARITY_MAX_DOMAINS=0 to check all)"
  ads_domains=$(printf '%s\n' "${ads_domains}" | head -n "${MAX_DOMAINS}")
fi

#
# 3. For each /ads/:domain URL, verify the page does NOT serve noindex.
#    Checks both the HTTP response header (x-robots-tag) and the HTML body
#    (<meta name="robots" content="noindex">). A 301 redirect to /search is
#    NOT a noindex — it is the #1282 cache-miss redirect (no page ships
#    empty) and is expected for domains that lost their cache; but a
#    sitemap-listed URL should NOT redirect, so that is flagged too.
#
noindex_hits=0
redirect_hits=0

while IFS= read -r domain; do
  [[ -z "${domain}" ]] && continue
  url="${BASE_URL}/ads/${domain}"
  checked=$((checked + 1))

  # Pacing: production rate-limits rapid sequential curls (429). A small
  # delay between requests keeps the canary under the limit without masking
  # a real outage — 429 is retried, other non-200s fail immediately.
  if [[ ${checked} -gt 1 ]]; then
    sleep "${DELAY}"
  fi

  # Fetch headers (do NOT follow redirects — a 301 to /search is detected
  # via -w and flagged as a parity break below). Retry on 429.
  http_code=""
  redirect_url=""
  for attempt in $(seq 0 "${RETRIES}"); do
    if [[ ${attempt} -gt 0 ]]; then
      log "retry ${attempt}/${RETRIES} after 429: ${url}"
      sleep $((DELAY * 2 * attempt))
    fi
    headers=$(curl -sSI --max-time "${TIMEOUT}" -o /dev/null -w '%{http_code} %{redirect_url}' "${url}" 2>/dev/null) \
      || fail "could not fetch headers for ${url}"
    http_code=$(printf '%s' "${headers}" | awk '{print $1}')
    redirect_url=$(printf '%s' "${headers}" | awk '{print $2}')
    [[ "${http_code}" != "429" ]] && break
  done

  if [[ "${http_code}" =~ ^3 ]]; then
    # A sitemap-listed /ads URL that redirects is a parity break: the
    # sitemap claims an indexable page but the URL does not serve one.
    log "REDIRECT: ${url} -> ${http_code} ${redirect_url}"
    redirect_hits=$((redirect_hits + 1))
    continue
  fi

  if [[ "${http_code}" != "200" ]]; then
    fail "${url} returned HTTP ${http_code} (expected 200)"
  fi

  # Check the x-robots-tag header for noindex.
  x_robots=$(curl -sSI --max-time "${TIMEOUT}" "${url}" 2>/dev/null | grep -i '^x-robots-tag:' || true)
  if printf '%s' "${x_robots}" | grep -qi 'noindex'; then
    log "NOINDEX-HEADER: ${url} serves x-robots-tag: noindex"
    noindex_hits=$((noindex_hits + 1))
    continue
  fi

  # Check the HTML body for the actual <meta name="robots" content="noindex"> tag.
  # NOT a bare grep for "noindex" — the React Router stream always contains the
  # loader-data key "noindex" (a boolean field name) regardless of indexability.
  body=$(curl -sS --max-time "${TIMEOUT}" "${url}" 2>/dev/null) \
    || fail "could not fetch body for ${url}"
  meta_noindex=$(printf '%s' "${body}" | grep -c '<meta name="robots" content="noindex"' || true)
  if [[ "${meta_noindex}" -gt 0 ]]; then
    log "NOINDEX-META: ${url} serves <meta name=\"robots\" content=\"noindex\">"
    noindex_hits=$((noindex_hits + 1))
    continue
  fi

  log "OK: ${url} (HTTP ${http_code}, no noindex)"
done <<< "${ads_domains}"

log "checked ${checked} /ads/:domain URL(s): ${noindex_hits} noindex hit(s), ${redirect_hits} redirect(s)"

if [[ "${noindex_hits}" -gt 0 ]]; then
  fail "${noindex_hits} sitemap-listed /ads page(s) serve noindex — sitemap/noindex parity is broken (issue #1283)"
fi

if [[ "${redirect_hits}" -gt 0 ]]; then
  fail "${redirect_hits} sitemap-listed /ads page(s) redirect instead of serving an indexable page — sitemap lists a URL that does not resolve to a page"
fi

log "PASS: all ${checked} sitemap-listed /ads/:domain URL(s) are indexable (no noindex meta tag or header)"
exit 0
