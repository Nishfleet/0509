import { describe, expect, it } from "vitest";
import {
  AI_TRAINING_CRAWLERS,
  GROUNDING_ENGINES,
  publicSeoFileForPathname,
} from "~/lib/seo";

// Regression test for the AEO robots.txt policy matrix (issue #2061).
//
// Worker-served robots.txt must:
//   - name grounding / AI-answer engines (Google-Extended, OAI-SearchBot,
//     PerplexityBot) with an explicit group, not just the `User-agent: *`
//     wildcard, so the AEO posture is intentional;
//   - allow those engines on the public proof surface (/, /search, /ads/**,
//     /timeline/**, /compare/**, /switch/**, /methodology, /brands, /llms.txt,
//     /llms-full.txt) while keeping /app/**, /api/**, /export/** out;
//   - keep Google-Extended OUT of AI_TRAINING_CRAWLERS (ai-train=no is not
//     weakened: the remaining training-only bots stay denied).
//
// Cloudflare managed robots prepends `User-agent: Google-Extended / Disallow: /`
// (live 0509.io, 2026-09-09). Google merges same-agent groups and, on equal
// path length, uses the least restrictive rule, so an explicit `Allow: /` in
// the worker file overrides that prepended Disallow. This test asserts both
// the worker body and the composed (prepend + worker) file.

interface RobotsRule {
  allow: boolean;
  pattern: string;
}
interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

function parseRobotsGroups(body: string): RobotsGroup[] {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);

  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      current = { agents: [value], rules: [] };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    if (field === "allow") {
      current.rules.push({ allow: true, pattern: value || "/" });
    } else if (field === "disallow") {
      current.rules.push({ allow: false, pattern: value || "/" });
    }
  }
  return groups;
}

// Google merges every group for the same user-agent and ignores the wildcard
// group when a specific group exists.
// https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
function mergedGroupFor(groups: RobotsGroup[], bot: string): RobotsGroup {
  const normalized = bot.toLowerCase();
  const specific: RobotsRule[] = [];
  let wildcard: RobotsGroup | null = null;
  for (const group of groups) {
    const agent = group.agents[0]?.toLowerCase() ?? "";
    if (agent === "*") wildcard = group;
    else if (agent === normalized) specific.push(...group.rules);
  }
  if (specific.length > 0) return { agents: [bot], rules: specific };
  return wildcard ?? { agents: ["*"], rules: [] };
}

function isPathAllowed(group: RobotsGroup, path: string): boolean {
  let bestMatch = "";
  let allowed = true;
  for (const rule of group.rules) {
    if (!ruleMatches(rule.pattern, path)) continue;
    if (rule.pattern.length > bestMatch.length) {
      bestMatch = rule.pattern;
      allowed = rule.allow;
    } else if (rule.pattern.length === bestMatch.length && rule.allow) {
      // Equal length: Google uses the least restrictive rule (Allow wins).
      allowed = true;
    }
  }
  return allowed;
}

function ruleMatches(pattern: string, path: string): boolean {
  if (!pattern) return path === "/" || path.startsWith("/");
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$/g, "$");
  const anchored = pattern.endsWith("$")
    ? `^${escaped.slice(0, -1)}$`
    : `^${escaped}`;
  return new RegExp(anchored).test(path);
}

const PUBLIC_PATHS = [
  "/",
  "/search",
  "/ads/zappos.com",
  "/timeline/nike.com",
  "/compare/panoramata",
  "/switch/panoramata",
  "/methodology",
  "/brands",
  "/llms.txt",
  "/llms-full.txt",
];

const PRIVATE_PATHS = [
  "/app",
  "/app/dashboard",
  "/api/",
  "/api/health",
  "/export/report.xlsx",
];

// Observed Cloudflare managed-robots prepend on https://0509.io/robots.txt
// (2026-09-09). Kept as a fixture so the composed-file assertion does not
// depend on a live fetch.
const CLOUDFLARE_MANAGED_PREFIX = `# BEGIN Cloudflare Managed content

User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /

User-agent: Amazonbot
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: CloudflareBrowserRenderingCrawler
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: meta-externalagent
Disallow: /

# END Cloudflare Managed Content
`;

function workerRobotsBody(): string {
  const body = publicSeoFileForPathname("/robots.txt")?.body ?? "";
  expect(body, "/robots.txt should be served").not.toBe("");
  return body;
}

describe("robots.txt AEO/AI policy matrix (issue #2061)", () => {
  const workerBody = workerRobotsBody();
  const workerGroups = parseRobotsGroups(workerBody);
  const composedGroups = parseRobotsGroups(`${CLOUDFLARE_MANAGED_PREFIX}\n${workerBody}`);

  it("names grounding engines with an explicit group (not just the wildcard)", () => {
    for (const bot of GROUNDING_ENGINES) {
      expect(workerBody, `${bot} should be named in worker robots.txt`).toContain(
        `User-agent: ${bot}`,
      );
      const group = mergedGroupFor(workerGroups, bot);
      expect(group.agents[0], `${bot} should have an explicit group`).toBe(bot);
    }
  });

  it("grants grounding engines the public proof surface", () => {
    for (const bot of GROUNDING_ENGINES) {
      const group = mergedGroupFor(workerGroups, bot);
      for (const path of PUBLIC_PATHS) {
        expect(isPathAllowed(group, path), `${bot} should reach ${path}`).toBe(true);
      }
    }
  });

  it("keeps grounding engines out of /app, /api, and /export", () => {
    for (const bot of GROUNDING_ENGINES) {
      const group = mergedGroupFor(workerGroups, bot);
      for (const path of PRIVATE_PATHS) {
        expect(isPathAllowed(group, path), `${bot} must not reach ${path}`).toBe(false);
      }
    }
  });

  it("does not weaken ai-train=no: training-only crawlers stay denied on every path", () => {
    expect(AI_TRAINING_CRAWLERS).toEqual(
      expect.arrayContaining([
        "Amazonbot",
        "Applebot-Extended",
        "Bytespider",
        "CCBot",
        "ClaudeBot",
        "CloudflareBrowserRenderingCrawler",
        "GPTBot",
        "meta-externalagent",
      ]),
    );
    for (const bot of AI_TRAINING_CRAWLERS) {
      const group = mergedGroupFor(composedGroups, bot);
      for (const path of [...PUBLIC_PATHS, ...PRIVATE_PATHS]) {
        expect(isPathAllowed(group, path), `${bot} must not reach ${path}`).toBe(false);
      }
    }
  });

  it("keeps Google-Extended out of the training-deny set", () => {
    expect(AI_TRAINING_CRAWLERS).not.toContain("Google-Extended");
    expect(GROUNDING_ENGINES).toContain("Google-Extended");
    expect(workerBody).not.toContain("User-agent: Google-Extended\nDisallow: /");
  });

  it("does not re-duplicate the Cloudflare training deny block (issue #1459)", () => {
    for (const bot of AI_TRAINING_CRAWLERS) {
      expect(workerBody, `${bot} must not be re-denied in the worker file`).not.toContain(
        `User-agent: ${bot}\nDisallow: /`,
      );
    }
  });

  it("overrides the Cloudflare Google-Extended Disallow on public paths via Google's merge + least-restrictive rule", () => {
    const group = mergedGroupFor(composedGroups, "Google-Extended");
    for (const path of PUBLIC_PATHS) {
      expect(
        isPathAllowed(group, path),
        `composed Google-Extended should reach ${path} even with the managed Disallow prepend`,
      ).toBe(true);
    }
    for (const path of PRIVATE_PATHS) {
      expect(
        isPathAllowed(group, path),
        `composed Google-Extended must not reach ${path}`,
      ).toBe(false);
    }
  });

  it("keeps the wildcard group able to crawl public paths for unlisted answer engines", () => {
    const wildcard = mergedGroupFor(workerGroups, "SomeoneNewBot");
    expect(wildcard.agents[0]).toBe("*");
    for (const path of PUBLIC_PATHS) {
      expect(isPathAllowed(wildcard, path), `wildcard should reach ${path}`).toBe(true);
    }
    for (const path of PRIVATE_PATHS) {
      expect(isPathAllowed(wildcard, path), `wildcard must not reach ${path}`).toBe(false);
    }
  });
});
