import { describe, expect, it } from "vitest";

import { registeredToolDescriptors } from "../../app/lib/agent/mcp-tools";
import { llmsTxt, type LlmsTxtSource } from "../../app/lib/public-routes";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const FRESH = { item_count: 4, fetched_at: "2026-09-28T11:00:00.000Z", canary_count: 1 } as const;

function source(key: string, platform: string) {
  return { key, platform, is_enabled: 1, degraded_reason: null, last_good_at: null, config_json: null };
}

function registryEntry(key: string, platform: string): LlmsTxtSource {
  return { source: source(key, platform), snapshot: FRESH };
}

const AGENTS_HEADING = "## Agents";

function agentToolLines(body: string): string[] {
  const start = body.indexOf(AGENTS_HEADING);
  expect(start, "llms.txt has no ## Agents section").toBeGreaterThanOrEqual(0);
  const afterHeading = start + AGENTS_HEADING.length;
  const nextHeading = body.indexOf("\n## ", afterHeading);
  const section = body.slice(afterHeading, nextHeading === -1 ? undefined : nextHeading);
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+\w+:\s/.test(line) && !line.startsWith("- ["));
}

describe("llms.txt MCP tool manifest", () => {
  it("the registry is pinned to the product-known five tools — the one literal expectation in the repo", () => {
    expect(Object.keys(registeredToolDescriptors).sort()).toEqual([
      "get_brief",
      "get_competitor",
      "get_standing",
      "list_alerts",
      "list_competitors",
    ]);
  });

  it("names exactly the registered tools, derived from the same export, and shows each registry title", () => {
    const body = llmsTxt(
      "https://0509.io",
      [
        registryEntry("site.web", "web"),
        registryEntry("hn.algolia", "hn"),
        registryEntry("gdelt.doc", "gdelt"),
        registryEntry("youtube.channel_rss", "youtube"),
      ],
      NOW,
    );

    const rendered = new Map<string, string>();
    for (const line of agentToolLines(body)) {
      const match = /^-\s+([a-z0-9_]+):\s+(.+)$/.exec(line);
      expect(match, `unexpected Agents bullet: ${line}`).not.toBeNull();
      rendered.set(match?.[1] ?? "", match?.[2] ?? "");
    }

    expect([...rendered.keys()].sort()).toEqual(Object.keys(registeredToolDescriptors).sort());
    for (const [name, tool] of Object.entries(registeredToolDescriptors)) {
      expect(rendered.get(name)).toBe(tool.title);
    }
  });

  it("keeps the hand-written three-tool comma list out of the manifest", () => {
    const body = llmsTxt("https://0509.io", [], NOW);
    expect(body).not.toContain("get_brief, list_competitors and list_alerts");
  });
});
