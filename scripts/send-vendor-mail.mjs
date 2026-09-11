#!/usr/bin/env node
// Repo-local outbound mail for prepared vendor listing submissions.
//
// Sends ONE plain-text email parsed from a prepared doc under docs/
// (To / From / Subject headers + `>` blockquote body in the doc's
// "Ready-to-send" section) via the Cloudflare Email Sending REST API —
// the same Cloudflare Email Service that backs the production Worker's
// `send_email` binding (wrangler.jsonc), just reached over the REST API
// because this script runs on node, outside a Worker. From-domain
// (0509.io) is already onboarded for the binding, so the REST path uses
// the same verified sender domain.
//
// DEFAULT IS DRY-RUN: nothing is sent and nothing is written unless
// `--send` is passed AND the credential env vars are set. It does NOT
// auto-send any of the four prepared pitches — each doc's NEEDS-NISH
// owner decision stands; a real send is a deliberate one-command action
// whose output is reviewed by the owner.
//
// Credentials come from the environment only (never committed, never
// printed):
//   CLOUDFLARE_API_TOKEN   token with Email Sending permission
//   CLOUDFLARE_ACCOUNT_ID  the account that owns 0509.io
//
// Usage:
//   node scripts/send-vendor-mail.mjs --dry-run --doc docs/adstack-listing-2026-08-11.md
//   node scripts/send-vendor-mail.mjs --send --doc docs/adstack-listing-2026-08-11.md
//
// On a successful real send, a receipt block (timestamp + per-recipient
// delivery status returned by the API) is appended to the doc's
// `## Receipts` section.
//
// Before the FIRST real --send: verify the endpoint and response shape
// against Cloudflare's official Email Sending docs (a wrong endpoint or
// payload fails closed — exit 1, no receipt written — but it should still
// be confirmed rather than discovered). The production Worker reaches the
// same Email Service via the runtime send_email binding
// (app/lib/delivery-email-core.server.ts), which is the fallback path if
// the REST route ever changes.
//
// Edge note: docs/segwise-listing-2026-08-21.md has no `To:` line (its
// recommended delivery is LinkedIn). Pass `--to <email>` to supply the
// recipient explicitly for that doc.

import { readFileSync, writeFileSync } from "node:fs";
import { posix as pathPosix } from "node:path";

const API_URL_BASE = "https://api.cloudflare.com/client/v4/accounts";
const DEFAULT_FROM = "support@0509.io";

/**
 * @typedef {Object} ParsedDoc
 * @property {string} [to]
 * @property {string} [from]
 * @property {string} [subject]
 * @property {string} [body]
 * @property {string[]} [errors]
 * @property {string} [section]
 */

/**
 * Parse the prepared email out of a vendor-listing doc.
 * Returns { to, from, subject, body, section } or { errors: [...] }.
 *
 * @param {string} markdown
 * @returns {ParsedDoc}
 */
export function parseDoc(markdown) {
  const errors = [];
  const lines = markdown.split(/\r?\n/);

  // Scope to the "Ready-to-send" section when present so we don't grab
  // quoted subject lines from the prose above it.
  let section = lines;
  const readyIdx = lines.findIndex((/** @type {string} */ l) =>
    /^#{2,3}\s.*ready-to-send/i.test(l),
  );
  if (readyIdx !== -1) {
    let end = lines.length;
    for (let i = readyIdx + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    section = lines.slice(readyIdx, end);
  }

  /** @param {string} label */
  const headerValue = (label) => {
    // No dynamic RegExp here: the label is compared as a plain string so
    // sgscan's ReDoS heuristic (detect-non-literal-regexp) stays quiet.
    const prefix = `${label.toLowerCase()}:`;
    const line = section.find((/** @type {string} */ l) => {
      const t = l.replace(/^\*+/, "").trim().toLowerCase();
      return t.startsWith(prefix);
    });
    if (!line) return undefined;
    // Value is conventionally in backticks; fall back to the raw text.
    const ticked = line.match(/`([^`]+)`/);
    return (ticked ? ticked[1] : line.replace(/^[^:]*:\s*/, "")).trim();
  };

  /**
   * Distinct values seen for a header label in the section. A section that
   * names several different recipients or subjects (e.g. the adyntel doc
   * carries two emails under one ready-to-send heading) must fail closed:
   * this tool sends exactly ONE email, and a silent first-match would pair
   * an override address with the wrong subject/body.
   * @param {string} label
   * @returns {Set<string>}
   */
  const distinctHeaderValues = (label) => {
    const prefix = `${label.toLowerCase()}:`;
    const vals = new Set();
    for (const line of section) {
      const t = line.replace(/^\*+/, "").trim().toLowerCase();
      if (!t.startsWith(prefix)) continue;
      const ticked = line.match(/`([^`]+)`/);
      vals.add((ticked ? ticked[1] : line.replace(/^[^:]*:\s*/, "")).trim());
    }
    return vals;
  };

  for (const label of ["To", "Subject"]) {
    const vals = distinctHeaderValues(label);
    if (vals.size > 1) {
      errors.push(
        `multiple distinct ${label}: headers (${vals.size}) in the ready-to-send section — this tool sends ONE email; split the doc or trim the section`,
      );
    }
  }

  const to = headerValue("To");
  const from = headerValue("From");
  const subject = headerValue("Subject");

  // Body: the contiguous blockquote run in the section.
  let bqStart = -1;
  let bqEnd = -1;
  for (let i = 0; i < section.length; i++) {
    if (/^>\s?/.test(section[i])) {
      if (bqStart === -1) bqStart = i;
      bqEnd = i + 1;
    } else if (bqStart !== -1 && section[i].trim() === "") {
      // allow blank lines inside the blockquote only if the next line
      // continues it; handled by trimming trailing blanks below.
      continue;
    } else if (bqStart !== -1) {
      break;
    }
  }
  let body;
  if (bqStart !== -1) {
    body = section
      .slice(bqStart, bqEnd)
      .map((l) => l.replace(/^>\s?/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\*\*/g, "")
      .trim();
  }

  if (!to) errors.push("no `To:` header found in the doc's ready-to-send section (pass --to to supply it)");
  if (!subject) errors.push("no `Subject:` header found in the doc's ready-to-send section");
  if (!body) errors.push("no `>` blockquote body found in the doc's ready-to-send section");

  if (errors.length) {
    // Fields parsed so far are still returned so an explicit --to/--subject
    // override in main() can resolve the matching missing-header error.
    return { to, from: from || DEFAULT_FROM, subject, body, errors, section: readyIdx === -1 ? "whole file" : "ready-to-send" };
  }
  return { to, from: from || DEFAULT_FROM, subject, body };
}

/**
 * @typedef {Object} Receipt
 * @property {string} timestamp
 * @property {string|undefined} to
 * @property {string} from
 * @property {string|undefined} subject
 * @property {number} httpStatus
 * @property {string[]} [delivered]
 * @property {string[]} [queued]
 * @property {string[]} [permanentBounces]
 */

/**
 * Format the receipt block appended to the doc after a real send.
 * Pure string building — no I/O, no secrets.
 *
 * @param {Receipt} receipt
 * @returns {string}
 */
export function formatReceipt(receipt) {
  const { timestamp, from, httpStatus, delivered = [], queued = [], permanentBounces = [] } = receipt;
  const { to = "", subject = "" } = receipt;

  const lines = [
    `### Send receipt — ${timestamp}`,
    "",
    `- **From:** ${from}`,
    `- **To:** ${to}`,
    `- **Subject:** ${subject}`,
    `- **Transport:** Cloudflare Email Sending REST API (same Email Service as the production \`send_email\` binding)`,
    `- **HTTP status:** ${httpStatus}`,
    `- **Delivered:** ${delivered.length ? delivered.join(", ") : "none"}`,
    `- **Queued:** ${queued.length ? queued.join(", ") : "none"}`,
    `- **Permanent bounces:** ${permanentBounces.length ? permanentBounces.join(", ") : "none"}`,
    "",
    `_Receipt appended by scripts/send-vendor-mail.mjs after a real \`--send\`. Owner decision per the doc's NEEDS-NISH marker was made before this send._`,
    "",
  ];
  return lines.join("\n");
}

/**
 * Append the receipt to the doc's `## Receipts` section (creating it if absent).
 *
 * @param {string} docPath
 * @param {string} receiptBlock
 * @param {{ readFileSync?: (p: string, enc: string) => string, writeFileSync?: (file: string, data: string, enc: string) => void }} [io]
 * @returns {boolean}
 */
export function appendReceipt(docPath, receiptBlock, { readFileSync: rf = readFileSync, writeFileSync: wf = writeFileSync } = {}) {
  const text = /** @type {string} */ (rf(docPath, "utf8"));
  const heading = /^##\s+Receipts\s*$/im;
  let next;
  const m = text.match(heading);
  if (m) {
    const at = /** @type {number} */ (m.index) + m[0].length;
    next = text.slice(0, at) + "\n\n" + receiptBlock.trimEnd() + "\n" + text.slice(at).replace(/^\n+/, "\n");
  } else {
    next = text.replace(/\n*$/, "\n\n") + "## Receipts\n\n" + receiptBlock.trimEnd() + "\n";
  }
  wf(docPath, next, "utf8");
  return true;
}

/**
 * @typedef {Object} MailMessage
 * @property {string} to
 * @property {string} from
 * @property {string} subject
 * @property {string} body
 */

/**
 * Send the email via the Email Sending REST API. `fetchImpl` is
 * injectable so tests can prove no network happens on the dry-run path.
 *
 * @param {MailMessage} message
 * @param {{ CLOUDFLARE_API_TOKEN?: string | undefined, CLOUDFLARE_ACCOUNT_ID?: string | undefined }} env
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: boolean, httpStatus: number, delivered?: string[], queued?: string[], permanentBounces?: string[], errors: string[] }>}
 */
export async function sendMail(message, env, fetchImpl = globalThis.fetch) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    return {
      ok: false,
      httpStatus: 0,
      errors: [
        "missing credentials: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (never commit or echo them)",
      ],
    };
  }
  const res = await fetchImpl(`${API_URL_BASE}/${accountId}/email/sending/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: message.to,
      from: { address: message.from },
      subject: message.subject,
      text: message.body,
    }),
  });
  let result = null;
  let apiErrors = [];
  try {
    const json = await res.json();
    result = json.result;
    apiErrors = json.errors ?? [];
  } catch {
    apiErrors = [{ code: 0, message: `non-JSON response (HTTP ${res.status})` }];
  }
  const ok =
    res.status === 200 &&
    !!result &&
    ((result.delivered?.length ?? 0) > 0 || (result.queued?.length ?? 0) > 0);
  if (ok) {
    return {
      ok: true,
      httpStatus: res.status,
      delivered: result.delivered,
      queued: result.queued,
      permanentBounces: result.permanent_bounces ?? [],
      errors: [],
    };
  }
  if (res.status === 200 && !result) {
    apiErrors = [{ code: 0, message: "HTTP 200 but no result payload from the API" }];
  }
  if (res.status === 200 && !ok && apiErrors.length === 0) {
    apiErrors = [{
      code: 0,
      message: `HTTP 200 but nothing was delivered or queued (delivered: 0, queued: 0, permanent_bounces: ${(result?.permanent_bounces ?? []).length})`,
    }];
  }
  return {
    ok,
    httpStatus: res.status,
    delivered: result?.delivered ?? [],
    queued: result?.queued ?? [],
    permanentBounces: result?.permanent_bounces ?? [],
    errors: ok ? [] : apiErrors.map((/** @type {{ code: number, message: string }} */ e) => `${e.code}: ${e.message}`),
  };
}

/**
 * @param {string[]} argv
 * @returns {{ doc: string | undefined, send: boolean, sendExplicit: boolean, dryRunExplicit: boolean, to: string | undefined, subject: string | undefined }}
 */
function parseArgs(argv) {
  const args = { doc: undefined, send: false, sendExplicit: false, dryRunExplicit: false, to: undefined, subject: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send") { args.send = true; args.sendExplicit = true; }
    else if (a === "--doc") args.doc = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--subject") args.subject = argv[++i];
    // --dry-run is the default; an explicit --dry-run must always win over
    // --send regardless of flag order (both-explicit is refused in main()).
    else if (a === "--dry-run") { args.send = false; args.dryRunExplicit = true; }
  }
  return args;
}

/**
 * @typedef {Object} MainOptions
 * @property {{ [k: string]: string | undefined }} [env]
 * @property {(s: string) => void} [stdout]
 * @property {(p: string) => string} [readFile]
 * @property {(file: string, data: string, enc: string) => void} [writeFile]
 * @property {typeof fetch} [fetchImpl]
 */

/**
 * CLI entry point.
 *
 * @param {string[]} argv
 * @param {MainOptions} [options]
 * @returns {Promise<number>}
 */
export async function main(argv, { env = process.env, stdout = console.log, readFile = (p) => readFileSync(p, "utf8"), writeFile = writeFileSync, fetchImpl } = {}) {
  const args = parseArgs(argv);
  if (args.sendExplicit && args.dryRunExplicit) {
    stdout("usage error: pass either --send or --dry-run, not both (ambiguous input is refused)");
    return 2;
  }
  if (!args.doc) {
    stdout("usage: node scripts/send-vendor-mail.mjs --doc <docs/<file>.md> [--send] [--to <email>] [--subject <text>]");
    return 2;
  }
  // Acceptance wording: the message is read from "a repo file under docs/".
  // Restricting the path also bounds where receipts can be written.
  const docNorm = pathPosix.normalize(args.doc);
  if (!docNorm.startsWith("docs/")) {
    stdout(`usage error: --doc must point at a file under docs/ (got ${args.doc})`);
    return 2;
  }
  const markdown = readFile(args.doc);
  const parsed = parseDoc(markdown);
  // An explicit --to/--subject override resolves the matching missing-header
  // parse error (e.g. docs/segwise-listing-2026-08-21.md has no To: line —
  // its recommended delivery is LinkedIn); any other parse gap stays fatal.
  /** @param {string} e */
  const overrideable = (e) =>
    (args.to && e.startsWith("no `To:` header")) ||
    (args.subject && e.startsWith("no `Subject:` header"));
  const fatal = (parsed.errors ?? []).filter((e) => !overrideable(e));
  if (fatal.length) {
    stdout(`ERROR: could not parse a complete email out of ${args.doc}:`);
    for (const e of fatal) stdout(`  - ${e}`);
    return 1;
  }
  const message = {
    to: args.to ?? parsed.to,
    from: parsed.from,
    subject: args.subject ?? parsed.subject,
    body: parsed.body,
  };

  if (!args.send) {
    stdout("DRY-RUN (no email sent, no receipt written). Pass --send plus CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID env to send for real.");
    stdout(`from:    ${message.from}`);
    stdout(`to:      ${message.to}${args.to && args.to !== parsed.to ? " (--to override)" : ""}`);
    stdout(`subject: ${message.subject}`);
    stdout("--- body ---");
    stdout(message.body);
    stdout("--- end body ---");
    return 0;
  }

  const result = await sendMail(message, env, fetchImpl);
  const delivery = okResult(result);
  const receipt = formatReceipt({
    timestamp: new Date().toISOString(),
    to: message.to,
    from: message.from,
    subject: message.subject,
    httpStatus: result.httpStatus,
    delivered: delivery.delivered,
    queued: delivery.queued,
    permanentBounces: delivery.permanentBounces,
  });
  if (result.ok) {
    appendReceipt(args.doc, receipt, { readFileSync: readFile, writeFileSync: writeFile });
    stdout(`sent. receipt appended to ${args.doc}:`);
    stdout(receipt);
    return 0;
  }
  stdout(`send FAILED (HTTP ${result.httpStatus}). No receipt written.`);
  for (const e of result.errors) stdout(`  - ${e}`);
  return 1;
}

/**
 * @param {{ ok: boolean, httpStatus: number, delivered?: string[], queued?: string[], permanentBounces?: string[], errors: string[] }} r
 * @returns {{ delivered: string[], queued: string[], permanentBounces: string[] }}
 */
function okResult(r) {
  return { delivered: r.delivered ?? [], queued: r.queued ?? [], permanentBounces: r.permanentBounces ?? [] };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  main(process.argv.slice(2))
    .then((/** @type {number} */ code) => process.exit(code))
    .catch((/** @type {unknown} */ err) => {
      // ENOENT on the doc, a fetch network failure, an odd response shape —
      // any of these must exit with a friendly message, not a raw
      // unhandled-rejection stack.
      console.error(`ERROR: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
