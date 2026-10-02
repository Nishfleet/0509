import { describe, expect, it } from "vitest";

import { namedTool, registeredToolDescriptors } from "../../app/lib/agent/mcp-tools";
import type { RegisteredToolName } from "../../app/lib/agent/mcp-tools";

const TOOL_NAMES: readonly RegisteredToolName[] = [
  "get_brief",
  "get_competitor",
  "get_standing",
  "list_alerts",
  "list_competitors",
];

const TOOL_TITLES: Record<RegisteredToolName, string> = {
  get_standing: "This week's ranking",
  get_brief: "This week's brief",
  list_competitors: "Competitors",
  get_competitor: "One competitor",
  list_alerts: "Alerts",
};

describe("namedTool", () => {
  it("covers every tool the descriptor table names", () => {
    expect([...TOOL_NAMES].sort()).toEqual(Object.keys(registeredToolDescriptors).sort());
  });

  it("returns each tool's name with the title its descriptor holds", () => {
    for (const name of TOOL_NAMES) {
      expect(namedTool(name), name).toEqual({ name, title: registeredToolDescriptors[name].title });
    }
  });

  it("holds the titles a customer reads for each tool", () => {
    for (const name of TOOL_NAMES) {
      expect(TOOL_TITLES[name], name).toBe(registeredToolDescriptors[name].title);
    }
  });

  it("gives the standing tool the ranking title", () => {
    expect(namedTool("get_standing")).toEqual({ name: "get_standing", title: "This week's ranking" });
  });
});
