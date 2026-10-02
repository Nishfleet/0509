import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, createRoutesStub, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AgentKeys, ConnectDetails } from "../../app/components/agent-settings";

const MCP_URL = "https://0509.io/mcp";
const ORIGIN = "https://0509.io";

function markup(): string {
  return renderToStaticMarkup(createElement(ConnectDetails, { mcpUrl: MCP_URL, origin: ORIGIN }));
}

const ONE_KEY = [
  {
    id: "a",
    name: "Only",
    start: "0509_ab",
    createdAt: "2026-09-01T00:00:00.000Z",
    lastUsedAt: null,
    rateLimitMax: null,
    remaining: null,
  },
];

function keysScreen(): ReactElement {
  return createElement(AgentKeys, { keys: ONE_KEY, newKey: null });
}

function buttons(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
}

// A real memory router whose only action never settles until the test
// releases it: calling navigate() puts the router in the same
// "submitting" state a double click would, with the form's own
// FormData on the navigation, so the pending render is the one the
// browser makes.
function pendingCreateKey() {
  const gate: { release: () => void } = { release: () => undefined };
  const settled = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  const formData = new FormData();
  formData.set("intent", "create-key");
  const router = createMemoryRouter([{ id: "r", path: "/", Component: keysScreen, action: () => settled }], {
    initialEntries: ["/"],
  });
  const submit = router.navigate("/", { formMethod: "post", formData });
  return {
    html: () => renderToStaticMarkup(createElement(RouterProvider, { router })),
    settle: async () => {
      gate.release();
      await submit;
    },
  };
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
    const openDetails = openRow.match(/<span class="block text-body-sm text-ink-soft">([^<]*)<\/span>/)?.[1];
    expect(openDetails).toBe("Created 1 Sept 2026 · never used");
    expect(openRow).not.toContain("requests");
  });

  it("leaves the Make a key button enabled with its resting label", () => {
    const Stub = createRoutesStub([{ path: "/", Component: keysScreen }]);
    const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
    const makeKey = buttons(html).find((button) => button.includes("Make a key")) ?? "";
    expect(makeKey).toContain("Make a key");
    expect(makeKey).not.toContain("Making…");
    expect(makeKey).not.toContain('disabled=""');
  });

  it("disables the Make a key button and labels it Making… while the create-key submit is in flight", () => {
    const pending = pendingCreateKey();
    const html = pending.html();
    const makeKey = buttons(html).find((button) => button.includes("Making…")) ?? "";
    expect(makeKey).toContain('disabled=""');
    expect(makeKey).toContain("Making…");
    expect(html).not.toContain("Make a key</button>");
  });

  it("leaves the revoke button enabled while the create-key submit is in flight", () => {
    const pending = pendingCreateKey();
    const html = pending.html();
    const revoke = buttons(html).find((button) => button.includes("Delete")) ?? "";
    expect(revoke).not.toContain('disabled=""');
    expect(revoke).not.toContain("Making…");
  });

  it("restores the enabled Make a key button once the submit lands", async () => {
    const pending = pendingCreateKey();
    expect(pending.html()).toContain("Making…");
    await pending.settle();
    const html = pending.html();
    const makeKey = buttons(html).find((button) => button.includes("Make a key")) ?? "";
    expect(makeKey).toContain("Make a key");
    expect(makeKey).not.toContain('disabled=""');
    expect(html).not.toContain("Making…");
  });
});

describe("the connect block on /app/settings/agents", () => {
  it("shows the MCP address to paste into an AI app", () => {
    expect(markup()).toContain(MCP_URL);
  });

  it("shows the Authorization header for connecting with a key", () => {
    expect(markup()).toContain("Authorization: Bearer &lt;your key&gt;");
  });

  it("links the API reference page", () => {
    expect(markup()).toContain(`href="${ORIGIN}/api/docs"`);
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
