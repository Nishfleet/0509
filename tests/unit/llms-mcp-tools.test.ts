import { describe, expect, it } from "vitest";

import { registeredToolDescriptors } from "../../app/lib/agent/mcp-tools";
import { llmsTxt, type LlmsTxtSource } from "../../app/lib/public-routes";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const FRESH = { item_count: 4, fetched_at: "2026-09-28T11:00:00.000Z", canary_count: 1 } as const;

function registryEntry(key: string, platform: string): LlmsTxtSource {
  return {
    source: { key, platform, is_enabled: 1, degraded_reason: null, last_good_at: null, config_json: null },
    snapshot: FRESH,
  };
}

const MANIFEST_TOOL_LINE = /^\s*- ([a-z0-9_]+): (.+)$/gm;

function agentsBlock(body: string): string {
  const start = body.indexOf("## Agents");
  expect(start).toBeGreaterThanOrEqual(0);
  const afterHeading = start + "## Agents".length;
  const nextHeading = body.indexOf("\n## ", afterHeading);
  return body.slice(afterHeading, nextHeading === -1 ? undefined : nextHeading);
}

function manifestTools(body: string): Map<string, string> {
  const tools = new Map<string, string>();
  for (const match of agentsBlock(body).matchAll(MANIFEST_TOOL_LINE)) {
    tools.set(match[1] ?? "", match[2] ?? "");
  }
  return tools;
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

  it("names every tool in the registry, derived from the same export, never a hand-written list", () => {
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
    expect([...manifestTools(body).keys()].sort()).toEqual(Object.keys(registeredToolDescriptors).sort());
  });

  it("describes each tool with the registry title, one bullet per tool, flat at the section level", () => {
    const tools = manifestTools(llmsTxt("https://0509.io", [], NOW));
    expect(tools.size).toBe(Object.keys(registeredToolDescriptors).length);
    for (const [name, tool] of Object.entries(registeredToolDescriptors)) {
      expect(tools.get(name)).toBe(tool.title);
    }
  });

  it("keeps the hand-written three-tool comma list out of the manifest", () => {
    const body = llmsTxt("https://0509.io", [], NOW);
    expect(body).not.toContain("get_brief, list_competitors and list_alerts");
  });
});
