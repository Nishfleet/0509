// Support mail for 0509#4229 (decision docs/USER-REPORTS.md).
//
// Email Routing delivers support@0509.io here. The raw MIME is stored in D1.
// The GitHub issue carries the id, the receipt time, 0509.io paths with the
// query string removed, and the User-Agent header when the mail has one.
// The sender, the subject, and the raw text have no field on that issue.
// Nothing in this file writes the raw message to a log.

const REPO = "Nishfleet/0509";

export const WORKER_NAME = "0509-support-inbox-v2";

export const REPORT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const SUPPORT_TO = "support@0509.io";

interface SupportInboxEnv {
  DB: D1Database;
  SUPPORT_INBOX_GITHUB_TOKEN?: string;
}

export interface SupportReport {
  id: string;
  received_at: number;
  from_domain: string;
  subject_sha256: string;
  raw: string;
}

export interface RoutingMatcher {
  type: string;
  field?: string;
  value?: string;
}

export interface RoutingAction {
  type: string;
  value?: string[];
}

export interface RoutingRule {
  matchers?: RoutingMatcher[];
  actions?: RoutingAction[];
}

const PATH_OK = /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%/-]|%[0-9A-Fa-f]{2})*$/;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function domainOfFrom(from: string): string {
  const angle = /<([^<>]+)>/.exec(from);
  const address = (angle?.[1] ?? from).trim();
  const at = address.lastIndexOf("@");
  if (at < 0) return "";
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".")) return "";
  return domain;
}

function singleLine(value: string): string | null {
  let cleaned = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    cleaned += code <= 31 || code === 127 ? " " : char;
  }
  cleaned = cleaned.replace(/[ \t]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

// Paths only. A query string can hold a magic-link token, so it is dropped.
// An address, a lookalike host, and a URL with userinfo are not paths.
export function pathsInText(text: string): string[] {
  const seen: string[] = [];
  const re =
    /https?:\/\/[^\s<>"')\]]+|(?<![A-Za-z0-9@.-])(?:[a-z0-9-]+\.)*0509\.io(?:\/[^\s<>"')\]]*)?/gi;
  for (const match of text.matchAll(re)) {
    const token = match[0].replace(/[.,;:]+$/, "");
    const start = match.index ?? 0;
    if (start > 0 && text[start - 1] === "@") continue;
    const withScheme = /^https?:\/\//i.test(token) ? token : `https://${token}`;
    if (!token.includes("/")) continue;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (host !== "0509.io" && !host.endsWith(".0509.io")) continue;
    if (url.username || url.password) continue;
    const path = url.pathname;
    if (path === "/" && !token.toLowerCase().includes("0509.io/")) continue;
    if (!PATH_OK.test(path)) continue;
    if (/%0d|%0a/i.test(path)) continue;
    if (!seen.includes(path)) seen.push(path);
  }
  return seen;
}

function issueBody(report: {
  id: string;
  receivedAt: number;
  paths: string[];
  userAgent: string | null;
}): string {
  const lines = [
    `id: ${report.id}`,
    `received_at: ${new Date(report.receivedAt).toISOString()}`,
    "paths:",
  ];
  if (report.paths.length === 0) lines.push("- (none)");
  else for (const path of report.paths) lines.push(`- ${path}`);
  if (report.userAgent) lines.push(`user_agent: ${report.userAgent}`);
  return lines.join("\n");
}

function githubHeaders(token: string): Headers {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/vnd.github+json");
  headers.set("x-github-api-version", "2022-11-28");
  headers.set("user-agent", WORKER_NAME);
  return headers;
}

async function discard(response: Response): Promise<void> {
  await response.arrayBuffer();
}

function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

async function issueAlreadyOpen(token: string, title: string): Promise<boolean> {
  const query = `repo:${REPO} is:issue in:title "${title}"`;
  const response = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}`, {
    headers: githubHeaders(token),
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    await discard(response);
    throw new Error(`github search redirect refused: ${String(response.status)}`);
  }
  if (!response.ok) {
    await discard(response);
    return false;
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("github search was not json");
  }
  const items = readField(data, "items");
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    if (readField(item, "title") === title) return true;
  }
  return false;
}

async function openGithubIssue(token: string, title: string, body: string): Promise<void> {
  if (await issueAlreadyOpen(token, title)) return;
  const headers = githubHeaders(token);
  headers.set("content-type", "application/json");
  const response = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers,
    redirect: "manual",
    body: JSON.stringify({
      title,
      body,
      labels: ["user-report", "machine-reported"],
    }),
  });
  if (response.status >= 300 && response.status < 400) {
    await discard(response);
    throw new Error(`github issue create redirect refused: ${String(response.status)}`);
  }
  if (!response.ok) {
    await discard(response);
    throw new Error(`github issue create failed: ${String(response.status)}`);
  }
  await discard(response);
}

export async function readSupportReport(
  db: D1Database,
  id: string,
  now: number,
): Promise<SupportReport | null> {
  const row = await db
    .prepare(
      `SELECT id, received_at, from_domain, subject_sha256, raw
       FROM support_report
       WHERE id = ? AND received_at >= ?`,
    )
    .bind(id, now - REPORT_TTL_MS)
    .first<SupportReport>();
  return row ?? null;
}

export async function deleteExpiredReports(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(`DELETE FROM support_report WHERE received_at < ?`)
    .bind(now - REPORT_TTL_MS)
    .run();
}

// Only the literal support@0509.io rule changes. alerts@, fleet-signup@,
// the catch-all, and any forward stay as they were.
export function moveSupportRule<T extends RoutingRule>(rules: readonly T[], workerName: string): T[] {
  return rules.map((rule) => {
    const hit = (rule.matchers ?? []).some(
      (matcher) => matcher.type === "literal" && matcher.field === "to" && matcher.value === SUPPORT_TO,
    );
    if (!hit) return rule;
    return { ...rule, actions: [{ type: "worker", value: [workerName] }] };
  });
}

export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    const fromDomain = domainOfFrom(message.headers.get("from") ?? message.from ?? "");
    const id = await sha256Hex(raw);
    const subjectSha256 = await sha256Hex(message.headers.get("subject") ?? "");
    try {
      await env.DB.prepare(
        `INSERT INTO support_report (id, received_at, from_domain, subject_sha256, raw)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
        .bind(id, Date.now(), fromDomain, subjectSha256, raw)
        .run();
    } catch {
      throw new Error("support report was not stored");
    }

    const stored = await readSupportReport(env.DB, id, Date.now());
    if (!stored) throw new Error("support report was not stored");

    const token = env.SUPPORT_INBOX_GITHUB_TOKEN;
    if (!token) {
      throw new Error(`SUPPORT_INBOX_GITHUB_TOKEN is not set on ${WORKER_NAME}`);
    }

    await openGithubIssue(
      token,
      `user report ${stored.id}`,
      issueBody({
        id: stored.id,
        receivedAt: stored.received_at,
        paths: pathsInText(raw),
        userAgent: singleLine(message.headers.get("user-agent") ?? ""),
      }),
    );
  },

  async scheduled(_controller, env) {
    await deleteExpiredReports(env.DB, Date.now());
  },

  fetch() {
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<SupportInboxEnv>;
