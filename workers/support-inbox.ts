import {
  claimIssueSlot,
  countRecentIssues,
  deleteExpiredIssues,
  releaseIssueSlot,
} from "../app/lib/data/support_issue.server";
import { deleteExpiredSupportReports, insertSupportReport } from "../app/lib/data/support_report.server";
import { fetchOutbound } from "../app/lib/fetch/outbound.server";
import { sha256Hex } from "../app/lib/sha256";

const FORWARD_TO = "nishant345@gmail.com";
const ISSUES_URL = "https://api.github.com/repos/Nishfleet/0509/issues";
const SITE_HOSTS = new Set(["0509.io", "www.0509.io"]);
const TOKEN_PATH_PREFIXES = ["/u/", "/v/", "/api/auth/"];
const MAX_PATHS = 10;
const MAX_UA = 200;

interface SupportInboxEnv {
  DB: D1Database;
  SUPPORT_INBOX_GITHUB_TOKEN?: string;
}

interface ReportMail {
  id: string;
  receivedAt: string;
  raw: string;
  userAgent: string;
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

function issueBody(report: ReportMail): string {
  const paths = sitePaths(report.raw);
  return [
    `report: ${report.id}`,
    `received: ${report.receivedAt}`,
    `paths: ${paths.length > 0 ? paths.join(", ") : "none"}`,
    `user agent: ${report.userAgent.slice(0, MAX_UA)}`,
  ].join("\n");
}

async function openIssue(token: string, report: ReportMail): Promise<Response> {
  return fetchOutbound(ISSUES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "0509-support-inbox-v2",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: `user report ${report.id}`,
      body: issueBody(report),
      labels: ["user-report", "machine-reported"],
    }),
  });
}

async function createIssue(db: D1Database, token: string, report: ReportMail): Promise<void> {
  let response: Response;
  try {
    response = await openIssue(token, report);
  } catch (error) {
    await releaseIssueSlot(db, report.id);
    console.error("support-inbox: issue create threw", String(error), report.id);
    return;
  }
  if (response.ok) return;
  await releaseIssueSlot(db, report.id);
  console.error("support-inbox: issue create failed", response.status, report.id);
}

async function sweep(db: D1Database, now: Date): Promise<void> {
  await deleteExpiredSupportReports(db, now);
  await deleteExpiredIssues(db, now);
}

export default {
  fetch() {
    return new Response(null, { status: 404 });
  },

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
    const token = env.SUPPORT_INBOX_GITHUB_TOKEN;
    if (!token) {
      console.error("support-inbox: SUPPORT_INBOX_GITHUB_TOKEN is not set", id);
      return;
    }
    const claimed = await claimIssueSlot(env.DB, { reportId: id, fromDomain, at: receivedAt });
    if (!claimed) {
      console.error(
        "support-inbox: issue cap reached",
        id,
        await countRecentIssues(env.DB, fromDomain, new Date(receivedAt)),
      );
      return;
    }
    const userAgent = message.headers.get("user-agent") ?? message.headers.get("x-mailer") ?? "none";
    await createIssue(env.DB, token, { id, receivedAt, raw, userAgent });
  },

  scheduled(controller, env, ctx) {
    ctx.waitUntil(sweep(env.DB, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<SupportInboxEnv>;
