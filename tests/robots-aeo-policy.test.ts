import { describe, expect, it } from "vitest";
import {
	AI_TRAINING_CRAWLERS,
	GROUNDING_ENGINES,
	publicSeoFileForPathname,
} from "~/lib/seo";

// Regression test for the AEO robots.txt policy matrix (issue #2061).
//
// The served robots.txt must:
//   - allow grounding / AI-answer engines (Google-Extended, OAI-SearchBot,
//     PerplexityBot) on the PUBLIC proof surface (/, /search, /ads/**, ...),
//     while keeping the private /app/** and /api/** out — this is explicit,
//     not just the `User-agent: *` wildcard fallthrough;
//   - keep AI training/fine-tuning crawlers Disallowed on every path
//     (ai-train=no is NOT weakened), and keep Google-Extended OUT of that
//     training-deny set because here it is an answer/reference engine.
//
// Re-adding Google-Extended to the training-deny list, or dropping any of the
// explicit answer-engine groups, fails loudly here.

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

function groupFor(groups: RobotsGroup[], bot: string): RobotsGroup {
	const normalized = bot.toLowerCase();
	// A specific group wins over the wildcard group.
	let wildcard: RobotsGroup | null = null;
	for (const group of groups) {
		const agent = group.agents[0].toLowerCase();
		if (agent === "*") wildcard = group;
		else if (agent === normalized) return group;
	}
	return wildcard ?? { agents: ["*"], rules: [] };
}

function isPathAllowed(group: RobotsGroup, path: string): boolean {
	let bestMatch = "";
	let allowed = true;
	for (const rule of group.rules) {
		if (ruleMatches(rule.pattern, path)) {
			if (rule.pattern.length > bestMatch.length) {
				bestMatch = rule.pattern;
				allowed = rule.allow;
			} else if (rule.pattern.length === bestMatch.length && !rule.allow) {
				allowed = false;
			}
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
	"/compare",
	"/switch",
	"/methodology",
	"/brands",
	"/llms.txt",
	"/llms-full.txt",
];

const PRIVATE_PATHS = ["/app", "/app/dashboard", "/api/", "/api/health", "/export/report.xlsx"];

function robotsBody(): string {
	const robots = publicSeoFileForPathname("/robots.txt");
	expect(robots?.body, "/robots.txt should be served").toBeTruthy();
	return robots!.body as string;
}

describe("robots.txt AEO/AI policy matrix (issue #2061)", () => {
	const body = robotsBody();
	const groups = parseRobotsGroups(body);

	it("grants grounding engines (Google-Extended, OAI-SearchBot, PerplexityBot) the full public proof surface", () => {
		for (const bot of GROUNDING_ENGINES) {
			const group = groupFor(groups, bot);
			expect(group.agents[0], `${bot} should have an explicit group`).toBe(bot);
			for (const path of PUBLIC_PATHS) {
				expect(isPathAllowed(group, path), `${bot} should reach ${path}`).toBe(true);
			}
		}
	});

	it("keeps the grounding engines out of the private /app, /api and /export surfaces", () => {
		for (const bot of GROUNDING_ENGINES) {
			const group = groupFor(groups, bot);
			for (const path of PRIVATE_PATHS) {
				expect(isPathAllowed(group, path), `${bot} must not reach ${path}`).toBe(false);
			}
		}
	});

	it("does not weaken ai-train=no: AI training/fine-tuning crawlers stay denied on every path", () => {
		for (const bot of AI_TRAINING_CRAWLERS) {
			const group = groupFor(groups, bot);
			expect(group.agents[0].toLowerCase(), `${bot} should have a deny group`).toBe(
				bot.toLowerCase(),
			);
			for (const path of [...PUBLIC_PATHS, ...PRIVATE_PATHS]) {
				expect(isPathAllowed(group, path), `${bot} must not reach ${path}`).toBe(false);
			}
		}
	});

	it("keeps Google-Extended out of the training-deny set (it is a grounding engine, not a training crawler)", () => {
		expect(AI_TRAINING_CRAWLERS).not.toContain("Google-Extended");
		expect(GROUNDING_ENGINES).toContain("Google-Extended");
	});

	it("keeps the wildcard group able to crawl public paths on behalf of unlisted answer engines", () => {
		const wildcard = groupFor(groups, "SomeoneNewBot");
		expect(wildcard.agents[0]).toBe("*");
		for (const path of PUBLIC_PATHS) {
			expect(isPathAllowed(wildcard, path), `wildcard should reach ${path}`).toBe(true);
		}
		for (const path of PRIVATE_PATHS) {
			expect(isPathAllowed(wildcard, path), `wildcard must not reach ${path}`).toBe(false);
		}
	});
});