import { describe, expect, it } from "vitest";

import { namedTool, registeredToolDescriptors, type RegisteredToolName } from "../../app/lib/agent/mcp-tools";

const TOOL_NAMES = Object.keys(registeredToolDescriptors) as RegisteredToolName[];

describe("namedTool", () => {
  it("takes the name and the title from one descriptor table", () => {
    for (const name of TOOL_NAMES) {
      expect(namedTool(name)).toEqual({ name, title: registeredToolDescriptors[name].title });
    }
  });

  it("names the standing tool with the ranking title", () => {
    expect(namedTool("get_standing")).toEqual({ name: "get_standing", title: "This week's ranking" });
  });
});
