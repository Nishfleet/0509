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
// Edge note: docs/segwise-listing-2026-08-21.md has no `To:` line (its
// recommended delivery is LinkedIn). Pass `--to <email>` to supply the
// recipient explicitly for that doc.

import { readFileSync, writeFileSync } from "node:fs";

const API_URL_BASE = "https://api.cloudflare.com/client/v4/accounts";
const DEFAULT_FROM = "support@0509.io";

/**
 * A successfully parsed email (to/from/subject/body all set) OR a list of
 * parse errors. On success `errors` is absent and the parsed fields are
 * present; on failure `errors` is a non-empty array. Never both.
 * @typedef {object} ParseResult
 * @property {string} [to]
 * @property {string} [from]
 * @property {string} [subject]
 * @property {string} [body]
 * @property {string[]} [errors]
 * @property {string} section
 */

/** @typedef {{ address: string }} Sender */

/** @typedef {{ to: string, from: string, subject: string, text: string }} SendPayload */

/**
 * Credential env. Values are optional here so callers/tests can pass a
 * partial env object; `sendMail` fails closed when they are missing.
 * @typedef {{ CLOUDFLARE_API_TOKEN?: string, CLOUDFLARE_ACCOUNT_ID?: string }}
 *   SendEnv
 */

/**
 * Injectable IO for tests (no network, no real FS writes).
 * @typedef {object} MailOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {(s: string) => void} [stdout]
 * @property {(p: string) => string} [readFile]
 * @property {(p: string, c: string) => void} [writeFile]
 * @property {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} [fetchImpl]
 */

/**
 * Parse the prepared email out of a vendor-listing doc.
 * @param {string} markdown
 * @returns {ParseResult}
 */
export function parseDoc(markdown) {
  /** @type {string[]} */
  const errors = [];
  const lines = markdown.split(/\r?\n/);

  // Scope to the "Ready-to-send" section when present so we don't grab
  // quoted subject lines from the prose above it.
  /** @type {string[]} */
  let section = lines;
  const readyIdx = lines.findIndex((l) => /^#{2,3}\s.*ready-to-send/i.test(l));
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

  /** @param {string} header @returns {string | undefined} */
  const headerValue = (header) => {
    // No dynamic RegExp here: the header name is compared as a plain
    // string so sgscan's ReDoS heuristic (detect-non-literal-regexp)
    // stays quiet.
    const prefix = `${header.toLowerCase()}:`;
    const line = section.find((l) => {
      const t = l.replace(/^\*+/, "").trim().toLowerCase();
      return t.startsWith(prefix);
    });
    if (!line) return undefined;
    // Value is conventionally in backticks; fall back to the raw text.
    const ticked = line.match(/`([^`]+)`/);
    return (ticked ? ticked[1] : line.replace(/^[^:]*:\s*/, "")).trim();
  };

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
  /** @type {string | undefined} */
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

  const sectionName = readyIdx === -1 ? "whole file" : "ready-to-send";
  if (errors.length) return { errors, section: sectionName };
  return { to: /** @type {string} */ (to), from: from || DEFAULT_FROM, subject: /** @type {string} */ (subject), body: /** @type {string} */ (body), section: sectionName };
}

/**
 * @typedef {object} Receipt
 * @property {string} timestamp
 * @property {string} to
 * @property {string} from
 * @property {string} subject
 * @property {number} httpStatus
 * @property {string[]} delivered
 * @property {string[]} queued
 * @property {string[]} permanentBounces
 */

/**
 * Format the receipt block appended to the doc after a real send.
 * Pure string building — no I/O, no secrets.
 * @param {Receipt} receipt
 * @returns {string}
 */
export function formatReceipt(receipt) {
  const { timestamp, to, from, subject, httpStatus, delivered = [], queued = [], permanentBounces = [] } = receipt;
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
 * @typedef {object} AppendIo
 * @property {(p: string) => string} [readFileSync]
 * @property {(p: string, c: string) => void} [writeFileSync]
 */

/**
 * Append the receipt to the doc's `## Receipts` section (creating it if
 * absent). Returns true on success.
 * @param {string} docPath
 * @param {string} receiptBlock
 * @param {AppendIo} [io]
 * @returns {boolean}
 */
export function appendReceipt(docPath, receiptBlock, { readFileSync: rf = (p) => readFileSync(p, "utf8"), writeFileSync: wf = (p, c) => writeFileSync(p, c) } = {}) {
  const text = rf(docPath);
  const heading = /^##\s+Receipts\s*$/im;
  const m = text.match(heading);
  /** @type {string | null} */
  let next = null;
  if (m) {
    const at = (m.index ?? 0) + m[0].length;
    next = text.slice(0, at) + "\n\n" + receiptBlock.trimEnd() + "\n" + text.slice(at).replace(/^\n+/, "\n");
  } else {
    next = text.replace(/\n*$/, "\n\n") + "## Receipts\n\n" + receiptBlock.trimEnd() + "\n";
  }
  wf(docPath, next ?? "");
  return true;
}

/**
 * @typedef {object} SendResult
 * @property {boolean} ok
 * @property {number} httpStatus
 * @property {string[]} delivered
 * @property {string[]} queued
 * @property {string[]} permanentBounces
 * @property {string[]} errors
 */

/**
 * A ready-to-send email message.
 * @typedef {object} Message
 * @property {string} to
 * @property {string} from
 * @property {string} subject
 * @property {string} body
 */

/**
 * Send the email via the Cloudflare Email Sending REST API. `fetchImpl`
 * is injectable so tests can prove no network happens on the dry-run path.
 * @param {Message} message
 * @param {SendEnv} env
 * @param {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} [fetchImpl]
 * @returns {Promise<SendResult>}
 */
export async function sendMail(message, env, fetchImpl = globalThis.fetch) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    return {
      ok: false,
      httpStatus: 0,
      delivered: [],
      queued: [],
      permanentBounces: [],
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
  /** @type {{ result?: any, errors?: Array<{ code: number, message: string }> } | undefined} */
  let parsedJson;

  try {
    parsedJson = /** @type {any} */ (await res.json());
  } catch {
    parsedJson = { errors: [{ code: 0, message: `non-JSON response (HTTP ${res.status})` }] };
  }
  const result = parsedJson?.result;
  /** @type {Array<{ code: number, message: string }>} */
  const apiErrors = Array.isArray(parsedJson?.errors) ? parsedJson.errors : [];
  const ok =
    res.status === 200 &&
    result &&
    ((Array.isArray(result.delivered) && result.delivered.length > 0) ||
      (Array.isArray(result.queued) && result.queued.length > 0));
  if (ok) {
    return {
      ok: true,
      httpStatus: res.status,
      delivered: result.delivered,
      queued: result.queued,
      permanentBounces: Array.isArray(result.permanent_bounces) ? result.permanent_bounces : [],
      errors: [],
    };
  }
  const finalErrors = res.status === 200 && !result
    ? [{ code: 0, message: "HTTP 200 but no result payload from the API" }]
    : apiErrors;
  return {
    ok,
    httpStatus: res.status,
    delivered: Array.isArray(result?.delivered) ? result.delivered : [],
    queued: Array.isArray(result?.queued) ? result.queued : [],
    permanentBounces: Array.isArray(result?.permanent_bounces) ? result.permanent_bounces : [],
    errors: ok ? [] : finalErrors.map((e) => `${e.code}: ${e.message}`),
  };
}

/**
 * @param {string[]} argv
 * @returns {{ doc: string | undefined, send: boolean, to: string | undefined, subject: string | undefined }}
 */
function parseArgs(argv) {
  /** @type {{ doc: string | undefined, send: boolean, to: string | undefined, subject: string | undefined }} */
  const args = { doc: undefined, send: false, to: undefined, subject: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send") args.send = true;
    else if (a === "--doc") args.doc = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--subject") args.subject = argv[++i];
    // --dry-run is the default; accepted and ignored for explicitness.
    else if (a === "--dry-run") args.send = false;
  }
  return args;
}

/**
 * Run the CLI. Returns a process exit code (0 = success, 1 = failure,
 * 2 = usage error).
 * @param {string[]} argv
 * @param {MailOptions} [opts]
 * @returns {Promise<number>}
 */
export async function main(argv, { env = process.env, stdout = console.log, readFile = (p) => readFileSync(p, "utf8"), writeFile = (p, c) => writeFileSync(p, c), fetchImpl } = {}) {
  const args = parseArgs(argv);
  if (!args.doc) {
    stdout("usage: node scripts/send-vendor-mail.mjs --doc <docs/<file>.md> [--send] [--to <email>] [--subject <text>]");
    return 2;
  }
  const docPath = args.doc;
  const markdown = readFile(docPath);
  const parsed = parseDoc(markdown);
  if (parsed.errors && parsed.errors.length > 0) {
    stdout(`ERROR: could not parse a complete email out of ${args.doc}:`);
    for (const e of parsed.errors) stdout(`  - ${e}`);
    return 1;
  }
  const ok = /** @type {{ to: string, from: string, subject: string, body: string }} */ (parsed);
  /** @type {Message} */
  const msg = {
    to: args.to ?? ok.to,
    from: ok.from,
    subject: args.subject ?? ok.subject,
    body: ok.body,
  };

  if (!args.send) {
    stdout("DRY-RUN (no email sent, no receipt written). Pass --send plus CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID env to send for real.");
    stdout(`from:    ${msg.from}`);
    stdout(`to:      ${msg.to}`);
    stdout(`subject: ${msg.subject}`);
    stdout("--- body ---");
    stdout(msg.body);
    stdout("--- end body ---");
    return 0;
  }

  const result = await sendMail(msg, env, fetchImpl);
  const receipt = formatReceipt({
    timestamp: new Date().toISOString(),
    to: msg.to,
    from: msg.from,
    subject: msg.subject,
    httpStatus: result.httpStatus,
    delivered: result.delivered,
    queued: result.queued,
    permanentBounces: result.permanentBounces,
  });
  if (result.ok) {
    appendReceipt(docPath, receipt, { readFileSync: readFile, writeFileSync: writeFile });
    stdout(`sent. receipt appended to ${docPath}:`);
    stdout(receipt);
    return 0;
  }
  stdout(`send FAILED (HTTP ${result.httpStatus}). No receipt written.`);
  for (const e of result.errors) stdout(`  - ${e}`);
  return 1;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}