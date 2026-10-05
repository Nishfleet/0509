import {
  countRecentSupportReports,
  countRecentSupportReportsAll,
  deleteExpiredSupportReports,
  insertSupportReport,
} from "../app/lib/data/support_report.server";
import { fetchOutbound } from "../app/lib/fetch/outbound.server";
import { sha256Hex } from "../app/lib/sha256";

const FORWARD_TO = "nishant345@gmail.com";
const ISSUES_URL = "https://api.github.com/repos/Nishfleet/0509/issues";
const SITE_HOSTS = new Set(["0509.io", "www.0509.io"]);
const TOKEN_PATH_PREFIXES = ["/u/", "/v/", "/api/auth/"];
const MAX_PATHS = 10;
const MAX_UA = 200;
export const MAX_ISSUES_PER_DOMAIN_PER_DAY = 3;
export const MAX_ISSUES_PER_DAY = 20;

interface SupportInboxEnv {
  DB: D1Database;
  SUPPORT_INBOX_GITHUB_TOKEN?: string;
}

function sitePaths(text: string): string[] {
  const paths = new Set<string>();
  for (const token of text.split(/[\s<>"()]+/)) {
    if (!token.startsWith("http")) continue;
    try {
      const url = new URL(token);
      if (SITE_HOSTS.has(url.hostname) && !TOKEN_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
        paths.add(url.pathname);
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "support_inbox.url_parse_failed", error: String(error) }));
      continue;
    }
  }
  return [...paths].slice(0, MAX_PATHS);
}

async function maybeOpenIssue(
  env: SupportInboxEnv,
  report: { id: string; receivedAt: string; fromDomain: string; raw: string; userAgent: string },
): Promise<void> {
  const { id, receivedAt, fromDomain, raw, userAgent } = report;
  const token = env.SUPPORT_INBOX_GITHUB_TOKEN;
  if (!token) {
    console.error("support-inbox: SUPPORT_INBOX_GITHUB_TOKEN is not set", id);
    return;
  }
  const received = new Date(receivedAt);
  const recent = await countRecentSupportReports(env.DB, fromDomain, received);
  const recentAll = await countRecentSupportReportsAll(env.DB, received);
  if (recent > MAX_ISSUES_PER_DOMAIN_PER_DAY || recentAll > MAX_ISSUES_PER_DAY) {
    console.error("support-inbox: issue cap reached", id);
    return;
  }
  const paths = sitePaths(raw);
  const body = [
    `report: ${id}`,
    `received: ${receivedAt}`,
    `paths: ${paths.length > 0 ? paths.join(", ") : "none"}`,
    `user agent: ${userAgent}`,
  ].join("\n");
  const response = await fetchOutbound(ISSUES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "0509-support-inbox-v2",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: `user report ${id}`,
      body,
      labels: ["user-report", "machine-reported"],
    }),
  });
  if (!response.ok) {
    console.error("support-inbox: issue create failed", response.status, id);
  }
}

export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    const id = crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    const fromDomain = (message.from.split("@").pop() ?? "").toLowerCase();
    await insertSupportReport(env.DB, {
      id,
      receivedAt,
      fromDomain,
      subjectSha256: await sha256Hex(message.headers.get("subject") ?? ""),
      raw,
    });
    await message.forward(FORWARD_TO);
    const userAgent = (message.headers.get("user-agent") ?? message.headers.get("x-mailer") ?? "none").slice(0, MAX_UA);
    await maybeOpenIssue(env, { id, receivedAt, fromDomain, raw, userAgent });
  },

  scheduled(controller, env, ctx) {
    ctx.waitUntil(deleteExpiredSupportReports(env.DB, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<SupportInboxEnv>;
