import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectDetails } from "../../app/components/agent-settings";

const MCP_URL = "https://0509.io/mcp";
const ORIGIN = "https://0509.io";

function markup(): string {
  return renderToStaticMarkup(createElement(ConnectDetails, { mcpUrl: MCP_URL, origin: ORIGIN }));
}

describe("the connect block on /app/settings/agents", () => {
  it("shows the MCP address to paste into an AI app", () => {
    expect(markup()).toContain(MCP_URL);
  });

  it("shows the Authorization header for connecting with a key", () => {
    expect(markup()).toContain("Authorization: Bearer &lt;your key&gt;");
  });

  it("names its clients as text-only pills, Claude then ChatGPT then Cursor", () => {
    const html = markup();
    const pills = [...html.matchAll(/<li[^>]*data-testid="agent-client"[^>]*>(.*?)<\/li>/g)].map((match) => match[1]);
    expect(pills).toEqual(["Claude", "ChatGPT", "Cursor"]);
  });

  it("carries no logos, no icons", () => {
    const html = markup();
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<svg");
  });
});
