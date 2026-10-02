import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, createRoutesStub, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AgentKeys, ConnectedApps, ConnectDetails } from "../../app/components/agent-settings";

const MCP_URL = "https://0509.io/mcp";
const ORIGIN = "https://0509.io";

function markup(): string {
  return renderToStaticMarkup(createElement(ConnectDetails, { mcpUrl: MCP_URL, origin: ORIGIN }));
}

function makeKey(id: string, name: string) {
  return {
    id,
    name,
    start: "0509_ab",
    createdAt: "2026-09-01T00:00:00.000Z",
    lastUsedAt: null,
    rateLimitMax: null,
    remaining: null,
  };
}

const SUBMISSION = "6f1d2c3b-0a4e-4b8f-9c7d-1e2f3a4b5c6d";

const ONE_KEY = [makeKey("a", "Only")];

const TWO_KEYS = [makeKey("a", "Laptop"), makeKey("b", "Nightly bot")];

function keysScreen(): ReactElement {
  return createElement(AgentKeys, { keys: ONE_KEY, newKey: null, submission: SUBMISSION });
}

const TWO_APPS = [
  { grantId: "g1", name: "Notion", connectedAt: "2026-09-01T00:00:00.000Z" },
  { grantId: "g2", name: "Linear", connectedAt: "2026-09-01T00:00:00.000Z" },
];

function appsScreen(): ReactElement {
  return createElement(ConnectedApps, { apps: TWO_APPS });
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
  return pendingSubmit(createElement(AgentKeys, { keys: TWO_KEYS, newKey: null, submission: SUBMISSION }), {
    intent: "create-key",
  });
}

function pendingRevokeKey(id: string) {
  return pendingSubmit(createElement(AgentKeys, { keys: TWO_KEYS, newKey: null, submission: SUBMISSION }), {
    intent: "revoke-key",
    id,
  });
}

function pendingSubmit(element: ReactElement, fields: Record<string, string>) {
  const gate: { release: () => void } = { release: () => undefined };
  const settled = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  const formData = new FormData();
  for (const [field, value] of Object.entries(fields)) {
    formData.set(field, value);
  }
  const router = createMemoryRouter([{ id: "r", path: "/", Component: () => element, action: () => settled }], {
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

function pendingDisconnect(intent: string, id: string | null) {
  const gate: { release: () => void } = { release: () => undefined };
  const settled = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  const formData = new FormData();
  formData.set("intent", intent);
  if (id !== null) {
    formData.set("id", id);
  }
  const router = createMemoryRouter([{ id: "r", path: "/", Component: appsScreen, action: () => settled }], {
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
            submission: SUBMISSION,
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
    const revoke = buttons(html).find((button) => button.includes('aria-label="Delete Laptop"')) ?? "";
    expect(revoke).not.toContain('disabled=""');
    expect(revoke).not.toContain("Making…");
  });

  it("names each Delete button with the key it removes", () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => createElement(AgentKeys, { keys: TWO_KEYS, newKey: null, submission: SUBMISSION }),
      },
    ]);
    const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
    expect(html).toContain('aria-label="Delete Laptop"');
    expect(html).toContain('aria-label="Delete Nightly bot"');
  });

  it("disables only the clicked key's Delete button and relabels it Deleting… while the revoke submit is in flight", () => {
    const pending = pendingRevokeKey("b");
    const html = pending.html();
    const deleting = buttons(html).find((button) => button.includes("Deleting…")) ?? "";
    expect(deleting).toContain('aria-label="Deleting Nightly bot"');
    expect(deleting).toContain('disabled=""');
    const laptop = buttons(html).find((button) => button.includes('aria-label="Delete Laptop"')) ?? "";
    expect(laptop).not.toContain('disabled=""');
    expect(laptop).toContain("Delete</button>");
  });

  it("restores the Delete button once the revoke lands", async () => {
    const pending = pendingRevokeKey("b");
    expect(pending.html()).toContain("Deleting…");
    await pending.settle();
    const html = pending.html();
    const laptop = buttons(html).find((button) => button.includes('aria-label="Delete Laptop"')) ?? "";
    expect(html).toContain('aria-label="Delete Nightly bot"');
    expect(laptop).not.toContain('disabled=""');
    expect(html).not.toContain("Deleting…");
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

describe("ConnectedApps", () => {
  it("leaves both Disconnect buttons enabled with their resting labels", () => {
    const Stub = createRoutesStub([{ path: "/", Component: appsScreen }]);
    const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
    const disconnects = buttons(html).filter((button) => button.includes("Disconnect"));
    expect(disconnects).toHaveLength(2);
    expect(disconnects.every((button) => button.includes(">Disconnect</button>"))).toBe(true);
    expect(disconnects.every((button) => !button.includes('disabled=""'))).toBe(true);
  });

  it("disables only the pressed app's Disconnect button and labels it Disconnecting… while the disconnect-app submit is in flight", () => {
    const pending = pendingDisconnect("disconnect-app", "g1");
    const html = pending.html();
    const disconnects = buttons(html).filter((button) => button.includes("Disconnect"));
    expect(disconnects).toHaveLength(2);
    const leaving = disconnects.find((button) => button.includes('aria-label="Disconnect Notion"')) ?? "";
    const other = disconnects.find((button) => button.includes('aria-label="Disconnect Linear"')) ?? "";
    expect(leaving).toContain('disabled=""');
    expect(leaving).toContain("Disconnecting…");
    expect(leaving).not.toContain(">Disconnect</button>");
    expect(other).toContain(">Disconnect</button>");
    expect(other).not.toContain('disabled=""');
    expect(other).not.toContain("Disconnecting…");
  });

  it("leaves the Disconnect buttons enabled while a revoke-key submit is in flight", () => {
    const pending = pendingDisconnect("revoke-key", "a");
    const html = pending.html();
    const disconnects = buttons(html).filter((button) => button.includes("Disconnect"));
    expect(disconnects.every((button) => button.includes(">Disconnect</button>"))).toBe(true);
    expect(disconnects.every((button) => !button.includes('disabled=""'))).toBe(true);
    expect(disconnects.every((button) => !button.includes("Disconnecting…"))).toBe(true);
  });

  it("restores the enabled Disconnect buttons once the submit lands", async () => {
    const pending = pendingDisconnect("disconnect-app", "g1");
    expect(pending.html()).toContain("Disconnecting…");
    await pending.settle();
    const html = pending.html();
    const disconnects = buttons(html).filter((button) => button.includes("Disconnect"));
    expect(disconnects.every((button) => button.includes(">Disconnect</button>"))).toBe(true);
    expect(disconnects.every((button) => !button.includes('disabled=""'))).toBe(true);
    expect(html).not.toContain("Disconnecting…");
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
