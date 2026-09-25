import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { AgentKeys, ConnectDetails } from "../../app/components/agent-settings";

const MCP_URL = "https://0509.io/mcp";
const ORIGIN = "https://0509.io";

function markup(): string {
  return renderToStaticMarkup(createElement(ConnectDetails, { mcpUrl: MCP_URL, origin: ORIGIN }));
}

describe("AgentKeys", () => {
  it("shows each key's rate limit and remaining requests when capped", () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () =>
          createElement(AgentKeys, {
            keys: [
              {
                id: "a",
                name: "Capped",
                start: "0509_ab",
                createdAt: "2026-09-01T00:00:00.000Z",
                lastUsedAt: null,
                rateLimitMax: 120,
                remaining: 42,
              },
              {
                id: "b",
                name: "Open",
                start: "0509_ab",
                createdAt: "2026-09-01T00:00:00.000Z",
                lastUsedAt: null,
                rateLimitMax: null,
                remaining: null,
              },
            ],
            newKey: null,
          }),
      },
    ]);
    const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));

    expect(html.match(/up to 120 requests a minute/g)).toHaveLength(1);
    expect(html.match(/42 requests left/g)).toHaveLength(1);
    const openRow = html.match(/<li[^>]*data-testid="api-key"[^>]*>[\s\S]*?<\/li>/g)?.[1] ?? "";
    expect(openRow).toContain("Made 1 Sept 2026 · never used");
    expect(openRow).not.toContain("requests");
  });
});

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
