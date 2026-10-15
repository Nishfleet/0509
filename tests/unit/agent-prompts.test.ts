import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentPrompts } from "../../app/components/agent-prompts";
import { AGENT_PROMPTS } from "../../app/lib/agent/prompts";
import { registeredToolDescriptors } from "../../app/lib/agent/mcp-tools";

describe("agent prompts", () => {
  it("shows every prompt with its own copy button", () => {
    const html = renderToStaticMarkup(createElement(AgentPrompts));
    expect(html).toContain("Try asking");
    for (const prompt of AGENT_PROMPTS) {
      expect(html).toContain(prompt.title);
      expect(html).toContain(`Copy prompt: ${prompt.title}`);
    }
  });

  it("only asks for what the read-only tools can answer", () => {
    const tools = Object.values(registeredToolDescriptors).map((tool) => tool.title.toLowerCase());
    expect(tools).toEqual(["this week's ranking", "this week's brief", "competitors", "one competitor", "alerts"]);
    for (const prompt of AGENT_PROMPTS) {
      expect(prompt.text.startsWith("Using Five to Nine,")).toBe(true);
      expect(prompt.text).not.toMatch(/\b(send|post|email|delete|cancel|schedule|every)\b/i);
    }
  });
});
