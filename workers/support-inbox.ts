import {
  deleteExpiredSupportReports,
  insertSupportReport,
} from "../app/lib/data/support_report.server";

const FORWARD_TO = "nishant345@gmail.com";
const ISSUES_URL = "https://api.github.com/repos/Nishfleet/0509/issues";
const SITE_HOSTS = new Set(["0509.io", "www.0509.io"]);
const TOKEN_PATH_PREFIXES = ["/u/", "/api/auth/"];
const MAX_PATHS = 10;
const MAX_UA = 200;

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
      if (
        SITE_HOSTS.has(url.hostname) &&
        !TOKEN_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
      ) {
        paths.add(url.pathname);
      }
    } catch {
      continue;
    }
  }
  return [...paths].slice(0, MAX_PATHS);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    const id = crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    await insertSupportReport(env.DB, {
      id,
      receivedAt,
      fromDomain: (message.from.split("@").pop() ?? "").toLowerCase(),
      subjectSha256: await sha256Hex(message.headers.get("subject") ?? ""),
      raw,
    });
    await message.forward(FORWARD_TO);
    const token = env.SUPPORT_INBOX_GITHUB_TOKEN;
    if (!token) {
      console.error("support-inbox: SUPPORT_INBOX_GITHUB_TOKEN is not set", id);
      return;
    }
    const userAgent = (
      message.headers.get("user-agent") ??
      message.headers.get("x-mailer") ??
      "none"
    ).slice(0, MAX_UA);
    const paths = sitePaths(raw);
    const body = [
      `report: ${id}`,
      `received: ${receivedAt}`,
      `paths: ${paths.length > 0 ? paths.join(", ") : "none"}`,
      `user agent: ${userAgent}`,
    ].join("\n");
    const response = await fetch(ISSUES_URL, {
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
  },

  scheduled(controller, env, ctx) {
    ctx.waitUntil(deleteExpiredSupportReports(env.DB, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<SupportInboxEnv>;
