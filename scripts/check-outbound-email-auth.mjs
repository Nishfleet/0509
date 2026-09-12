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
  /** @type {string[]} */
  const records = [];
  // Chunks already collected for the logical record being assembled.
  /** @type {string[]} */
  let chunks = [];
  // True while we are inside a quoted string that has not been closed yet.
  let open = false;

  for (const line of lines) {
    // Unquoted output (a zone-file style answer) is its own record, and it
    // also terminates any logical record still being assembled above it.
    if (!open && !line.startsWith('"')) {
      if (chunks.length > 0) {
        records.push(chunks.join(""));
        chunks = [];
      }
      records.push(line);
      continue;
    }

    // Walk the line quote by quote. dig wraps one TXT string as `"..."` and
    // emits a fresh quoted chunk per 255 bytes, on the SAME line when it fits
    // and on the NEXT physical line when it does not. A record is finished
    // exactly when a closing quote leaves us outside a string.
    for (const ch of line) {
      if (ch === '"') {
        open = !open;
        continue;
      }
      if (!open) continue; // characters between chunks carry no record data
      if (chunks.length === 0) chunks.push("");
      chunks[chunks.length - 1] += ch;
    }

    // The chunk ended: close the record only when the quote state is closed.
    if (!open && chunks.length > 0) {
      records.push(chunks.join(""));
      chunks = [];
    }
  }

  // An unterminated tail means dig was cut off mid-record: surface it rather
  // than dropping it, so the caller sees a malformed record instead of none.
  if (chunks.length > 0) records.push(chunks.join(""));

  return records;
}

/**
 * @param {string} text the TXT policy record
 * @returns {Record<string, string>} lowercased tag -> value pairs
 */
function parseTxtValue(text) {
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
  } else {
    // RFC 7208: the LAST matching `all` mechanism wins, and the qualifier is
    // case-insensitive. Compare the term itself, never a substring — a plain
    // `includes("~all")` reads any stray text as a softfail regression.
    const terms = spf.split(/\s+/).map((t) => t.toLowerCase());
    const allTerm = [...terms].reverse().find((t) => /^(\+|-|~|\?)?all$/.test(t));
    if (allTerm === "~all") {
      failures.push(`SPF: still softfail (~all): "${spf}" — upgrade to -all now that senders are confirmed`);
    } else if (allTerm === "?all") {
      failures.push(`SPF: neutral (?all): "${spf}" — SPF asserts nothing, use -all`);
    } else if (allTerm !== "-all") {
      failures.push(`SPF: record "${spf}" has no -all hardfail term`);
    } else if (!spf.includes("include:_spf.mx.cloudflare.net")) {
      failures.push(`SPF: "${spf}" does not include the Cloudflare sender network (_spf.mx.cloudflare.net)`);
    }
  }

  const dmarc = dmarcRecords.find((r) => r.toUpperCase().startsWith("V=DMARC1"));
  if (!dmarc) {
    failures.push("DMARC: no v=DMARC1 TXT found at _dmarc — DMARC not published");
  } else {
    const tags = parseTxtValue(dmarc);
    // DMARC tag values are case-insensitive (RFC 7489), so compare lowercased.
    const policy = (tags.p || "").toLowerCase();
    if (!policy) {
      failures.push(`DMARC: record "${dmarc}" has no p= policy tag`);
    } else if (!["quarantine", "reject"].includes(policy)) {
      failures.push(`DMARC: p=${tags.p} is not enforcement (quarantine|reject)`);
    }
    // A reporting endpoint needs a real address, not merely a `mailto:` prefix.
    if (!/^mailto:[^@\s;]+@[^@\s;]+$/i.test((tags.rua || "").trim())) {
      failures.push(`DMARC: record "${dmarc}" has no usable rua=mailto: reporting endpoint`);
    }
  }

  for (const selector of requiredSelectors) {
    const recs = dkimSelectors.get(selector) || [];
    if (recs.length === 0) {
      failures.push(`DKIM: no TXT at ${selector}._domainkey — selector not published`);
      continue;
    }
    // Judge the JOINED record. A key split across 255-byte chunks only reaches
    // its true length after parseTxtRecords reassembles it, so this is also
    // what catches a truncated join: it cannot reach the floor below.
    const dkim = recs.find((r) => r.startsWith("v=DKIM1"));
    if (!dkim) {
      failures.push(`DKIM: no v=DKIM1 TXT at ${selector}._domainkey — selector not published`);
      continue;
    }
    const key = (dkim.match(/p=([A-Za-z0-9+/]+)/) || [])[1] || "";
    // A real 2048-bit RSA key is ~392 base64 chars; 300 is a floor that a
    // single 255-byte chunk cannot reach even when padded to its limit.
    if (key.length < 300) {
      failures.push(
        `DKIM: ${selector}._domainkey key is only ${key.length} chars — truncated or empty record?`
      );
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
    // The name is validated against a strict selector charset by the caller,
    // so no argument can start with `+`/`-` and be read as a dig option.
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
  /** @type {Map<string, string[]>} */
  const dkimSelectors = new Map();
  await Promise.all(
    selectors.map(async (selector) => {
      dkimSelectors.set(selector, await digTxt(`${selector}._domainkey.${domain}`));
    })
  );
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
  const bad = selectors.filter((s) => !/^[A-Za-z0-9._-]+$/.test(s));
  if (bad.length > 0) {
    console.error(`outbound email auth check: invalid DKIM selector(s): ${bad.join(", ")}`);
    process.exit(2);
  }
  try {
    const summary = await runLiveCheck({ selectors });
    // Output format and exit code are INDEPENDENT. `--json` is the mode
    // automation uses, so it must still exit non-zero on a regression —
    // otherwise the gate reports ok:false and passes CI.
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(summary, null, 2));
    } else if (summary.ok) {
      console.log(
        `outbound email auth OK: SPF -all hardened, DMARC p=* with rua=, DKIM published at: ${summary.dkimFound.join(", ")}`
      );
    } else {
      for (const f of summary.failures) console.error(`FAIL: ${f}`);
      console.error(`outbound email auth check: ${summary.failures.length} failure(s). Fix the records above before shipping.`);
    }
    if (!summary.ok) process.exit(1);
  } catch (err) {
    console.error(`outbound email auth check: infrastructure error — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}
