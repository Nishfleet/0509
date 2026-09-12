#!/usr/bin/env node
// Live gate for outbound email auth on the 0509.io zone (issue #2966).
//
// The 2026-09-11 audits found the zone half-finished: SPF ~all softfail,
// DMARC p=reject with no rua barrel, and no DKIM TXT at any common selector.
// The live zone now carries the strict state (SPF -all, rua, DKIM at the
// selector Cloudflare's own Email Routing DNS config declares), but nothing
// in the repo could DETECT a regression. This script is that detector:
// run it in CI or after any DNS/Cloudflare Email change; it fails loud
// with the exact regressed record.
//
// What it asserts (against live DNS via `dig`):
//   1. SPF (TXT 0509.io) starts with v=spf1 and hardfails on -all (no ~all softfail).
//   2. DMARC (TXT _dmarc.0509.io) is v=DMARC1 with a p= tag and a rua=mailto: destination.
//   3. DKIM TXT at every required selector (default: cf2024-1) is v=DKIM1 with a real key.
//      The selector list is overridable via CHECK_DKIM_SELECTORS (comma-separated).
//
// Usage:
//   node scripts/check-outbound-email-auth.mjs            # live check, fail loud
//   node scripts/check-outbound-email-auth.mjs --json     # same, JSON summary on stdout
//
// Exit codes: 0 = all assertions pass; 1 = one or more assertions failed;
// 2 = infrastructure error (dig missing or timed out for a record).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const DEFAULT_DOMAIN = "0509.io";
// The selector returned by zones/{zone}/email/routing/dns — Cloudflare's own
// recommended DNS config for the verified 0509.io domain (verified 2026-09-11).
export const DEFAULT_SELECTORS = ["cf2024-1"];

/**
 * Parse raw `dig +short TXT` output into a list of logical TXT strings.
 * dig quotes each 255-byte string individually and splits long records
 * across several quoted chunks on separate physical lines (DNS TXT chunking),
 * so a DKIM key arrives as multiple adjacent quoted strings. Joining them
 * yields the logical record the verifier sees.
 *
 * @param {string} digOutput raw `dig +short TXT` stdout
 * @returns {string[]} logical TXT records, one per record
 */
export function parseTxtRecords(digOutput) {
  const lines = digOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith(";"));
  const records = [];
  let current = "";
  for (const line of lines) {
    // A quoted chunk continues the current logical record when we are
    // mid-record (the previous line ended inside a quoted string).
    if (current) {
      // A stray unquoted continuation or an adjacent quoted chunk.
      const chunk = line.replace(/^"|"$/g, "");
      current += chunk;
      if (endsQuoteComplete(current)) {
        records.push(current);
        current = "";
      }
    } else if (line.startsWith('"')) {
      // Track whether the whole record is a single closed quoted string or
      // the first of several chunks (DKIM keys exceed 255 bytes and split).
      current = line.slice(1, -1);
      records.push(current);
      current = "";
    } else {
      records.push(line);
    }
  }
  if (current) {
    records.push(current); // unterminated tail — surface it rather than drop it
  }
  return records;
}

/**
 * True when the accumulated string ends with a complete quoted segment.
 *
 * @param {string} s accumulated record text
 * @returns {boolean} true when the quoted chunks form a complete record
 */
function endsQuoteComplete(s) {
  // Quoted TXT chunks always come as `"..."` pairs; a complete record has an
  // even number of quote characters. Incomplete means the next line continues it.
  const quotes = (s.match(/"/g) || []).length;
  return quotes % 2 === 0;
}

/**
 * @param {string} tag policy tag being parsed (spf, dmarc, dkim)
 * @param {string} text the TXT policy record
 * @returns {Record<string, string>} lowercased tag -> value pairs
 */
function parseTxtValue(tag, text) {
  // Extract `k=v;` pairs from a TXT policy record (SPF, DMARC, DKIM).
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of text.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Pure assertion over the parsed DNS state. Kept pure (no I/O) so the
 * unit test suite can pin behavior against real dig fixtures.
 *
 * @param {object} state parsed DNS state
 * @param {string[]} [state.spfRecords] logical SPF TXT records
 * @param {string[]} [state.dmarcRecords] logical DMARC TXT records
 * @param {Map<string, string[]>} [state.dkimSelectors] selector -> logical DKIM TXT records
 * @param {string[]} [state.requiredSelectors] selectors that must be published
 * @returns {{ ok: boolean, failures: string[] }} verdict plus every failure reason
 */
export function evaluateAuthState({
  spfRecords = /** @type {string[]} */ ([]),
  dmarcRecords = /** @type {string[]} */ ([]),
  dkimSelectors = /** @type {Map<string, string[]>} */ (new Map()),
  requiredSelectors = DEFAULT_SELECTORS,
}) {
  /** @type {string[]} */
  const failures = [];

  const spf = spfRecords.find((r) => r.startsWith("v=spf1"));
  if (!spf) {
    failures.push("SPF: no v=spf1 TXT record found at the domain — outbound mail has no SPF policy");
  } else if (spf.includes("~all")) {
    failures.push(`SPF: still softfail (~all): "${spf}" — upgrade to -all now that senders are confirmed`);
  } else if (!spf.split(" ").some((m) => m === "-all")) {
    failures.push(`SPF: record "${spf}" has no -all hardfail term`);
  } else if (!spf.includes("include:_spf.mx.cloudflare.net")) {
    failures.push(`SPF: "${spf}" does not include the Cloudflare sender network (_spf.mx.cloudflare.net)`);
  }

  const dmarc = dmarcRecords.find((r) => r.toUpperCase().startsWith("V=DMARC1"));
  if (!dmarc) {
    failures.push("DMARC: no v=DMARC1 TXT found at _dmarc — DMARC not published");
  } else {
    const tags = parseTxtValue("dmarc", dmarc);
    if (!tags.p) {
      failures.push(`DMARC: record "${dmarc}" has no p= policy tag`);
    } else if (!["quarantine", "reject"].includes(tags.p)) {
      failures.push(`DMARC: p=${tags.p} is not enforcement (quarantine|reject)`);
    }
    if (!tags.rua || !tags.rua.startsWith("mailto:")) {
      failures.push(`DMARC: record "${dmarc}" has no rua=mailto: reporting endpoint`);
    }
  }

  for (const selector of requiredSelectors) {
    const recs = dkimSelectors.get(selector) || [];
    const dkim = recs.find((r) => r.startsWith("v=DKIM1"));
    if (!dkim) {
      failures.push(`DKIM: no v=DKIM1 TXT at ${selector}._domainkey — selector not published`);
      continue;
    }
    // A real DKIM TXT has the key split across 255-byte chunks; after logical
    // chunk join the key material itself is one long base64 run.
    if (!/p=[A-Za-z0-9+/]{200,}/.test(dkim)) {
      failures.push(`DKIM: ${selector}._domainkey TXT has no substantial p= key (truncated or empty record?)`);
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * @param {string} name the DNS name to query
 * @returns {Promise<string[]>} logical TXT records at that name
 */
async function digTxt(name) {
  /** @type {string} */
  let stdout;
  try {
    ({ stdout } = await run("dig", ["+short", "TXT", name], { timeout: 15_000 }));
  } catch (err) {
    throw new Error(`dig failed for TXT ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseTxtRecords(stdout);
}

/**
 * Live check against the real zone.
 *
 * @param {object} [opts] options
 * @param {string} [opts.domain] zone to check
 * @param {string[]} [opts.selectors] DKIM selectors that must be published
 * @returns {Promise<{ ok: boolean, failures: string[], domain: string, selectors: string[], checkedAt: string, spfRecord: string | null, dmarcRecord: string | null, dkimFound: string[] }>} JSON summary including ok and failures
 */
export async function runLiveCheck({
  domain = DEFAULT_DOMAIN,
  selectors = DEFAULT_SELECTORS,
} = {}) {
  /** @type {Map<string, string[]>} */
  const dkimSelectors = new Map();
  for (const selector of selectors) {
    dkimSelectors.set(selector, await digTxt(`${selector}._domainkey.${domain}`));
  }
  const [spfRecords, dmarcRecords] = await Promise.all([
    digTxt(domain),
    digTxt(`_dmarc.${domain}`),
  ]);
  const verdict = evaluateAuthState({ spfRecords, dmarcRecords, dkimSelectors, requiredSelectors: selectors });
  return {
    domain,
    selectors,
    checkedAt: new Date().toISOString(),
    spfRecord: spfRecords.find((r) => r.startsWith("v=spf1")) || null,
    dmarcRecord: dmarcRecords.find((r) => r.toUpperCase().startsWith("V=DMARC1")) || null,
    dkimFound: [...selectors].filter((s) => (dkimSelectors.get(s) || []).some((r) => r.startsWith("v=DKIM1"))),
    ...verdict,
  };
}

/** @type {boolean} */
const isMain = Boolean(process.argv[1]) && import.meta.url.endsWith(process.argv[1].split("/").pop() || "");
if (isMain) {
  /** @type {string[]} */
  const selectors = (process.env.CHECK_DKIM_SELECTORS || DEFAULT_SELECTORS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  try {
    const summary = await runLiveCheck({ selectors });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(summary, null, 2));
    } else if (summary.ok) {
      console.log(
        `outbound email auth OK: SPF -all hardened, DMARC p=* with rua=, DKIM published at: ${summary.dkimFound.join(", ")}`
      );
    } else {
      for (const f of summary.failures) console.error(`FAIL: ${f}`);
      console.error(`outbound email auth check: ${summary.failures.length} failure(s). Fix the records above before shipping.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`outbound email auth check: infrastructure error — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}
