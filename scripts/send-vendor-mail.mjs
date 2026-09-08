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
 * Parse the prepared email out of a vendor-listing doc.
 * Returns { to, from, subject, body, section } or { errors: [...] }.
 */
export function parseDoc(markdown) {
  const errors = [];
  const lines = markdown.split(/\r?\n/);

  // Scope to the "Ready-to-send" section when present so we don't grab
  // quoted subject lines from the prose above it.
  let section = lines;
  const readyIdx = lines.findIndex((l) =>
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

  const headerValue = (label) => {
    const line = section.find((l) =>
      new RegExp(`^\\*\\*?${label}\\s*:`, "i").test(l) ||
      new RegExp(`^${label}\\s*:`, "i").test(l),
    );
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

  if (errors.length) return { errors, section: readyIdx === -1 ? "whole file" : "ready-to-send" };
  return { to, from: from || DEFAULT_FROM, subject, body };
}

/**
 * Format the receipt block appended to the doc after a real send.
 * Pure string building — no I/O, no secrets.
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

/** Append the receipt to the doc's `## Receipts` section (creating it if absent). */
export function appendReceipt(docPath, receiptBlock, { readFileSync: rf = readFileSync, writeFileSync: wf = writeFileSync } = {}) {
  const text = rf(docPath, "utf8");
  const heading = /^##\s+Receipts\s*$/im;
  let next;
  const m = text.match(heading);
  if (m) {
    const at = m.index + m[0].length;
    next = text.slice(0, at) + "\n\n" + receiptBlock.trimEnd() + "\n" + text.slice(at).replace(/^\n+/, "\n");
  } else {
    next = text.replace(/\n*$/, "\n\n") + "## Receipts\n\n" + receiptBlock.trimEnd() + "\n";
  }
  wf(docPath, next, "utf8");
  return true;
}

/**
 * Send the email via the Email Sending REST API. `fetchImpl` is
 * injectable so tests can prove no network happens on the dry-run path.
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
    result &&
    ((result.delivered?.length ?? 0) > 0 || (result.queued?.length ?? 0) > 0);
  return {
    ok,
    httpStatus: res.status,
    delivered: result?.delivered ?? [],
    queued: result?.queued ?? [],
    permanentBounces: result?.permanent_bounces ?? [],
    errors: ok ? [] : apiErrors.map((e) => `${e.code}: ${e.message}`),
  };
}

function parseArgs(argv) {
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

export async function main(argv, { env = process.env, stdout = console.log, readFile = (p) => readFileSync(p, "utf8"), writeFile = writeFileSync, fetchImpl } = {}) {
  const args = parseArgs(argv);
  if (!args.doc) {
    stdout("usage: node scripts/send-vendor-mail.mjs --doc <docs/<file>.md> [--send] [--to <email>] [--subject <text>]");
    return 2;
  }
  const markdown = readFile(args.doc);
  const parsed = parseDoc(markdown);
  if (parsed.errors) {
    stdout(`ERROR: could not parse a complete email out of ${args.doc}:`);
    for (const e of parsed.errors) stdout(`  - ${e}`);
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
    stdout(`to:      ${message.to}`);
    stdout(`subject: ${message.subject}`);
    stdout("--- body ---");
    stdout(message.body);
    stdout("--- end body ---");
    return 0;
  }

  const result = await sendMail(message, env, fetchImpl);
  const receipt = formatReceipt({
    timestamp: new Date().toISOString(),
    to: message.to,
    from: message.from,
    subject: message.subject,
    httpStatus: result.httpStatus,
    delivered: result.delivered,
    queued: result.queued,
    permanentBounces: result.permanentBounces,
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

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
