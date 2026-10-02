import { createElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, createRoutesStub, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentKeys,
  ConnectedApps,
  ConnectDetails,
  CopyFailureNote,
  CopyKey,
  copyKeyLabel,
  copyToClipboard,
} from "../../app/components/agent-settings";

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

const ONE_KEY = [makeKey("a", "Only")];

const TWO_KEYS = [makeKey("a", "Laptop"), makeKey("b", "Nightly bot")];

function keysScreen(): ReactElement {
  return createElement(AgentKeys, { keys: ONE_KEY, newKey: null });
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
  return pendingSubmit(createElement(AgentKeys, { keys: TWO_KEYS, newKey: null }), { intent: "create-key" });
}

function pendingRevokeKey(id: string) {
  return pendingSubmit(createElement(AgentKeys, { keys: TWO_KEYS, newKey: null }), { intent: "revoke-key", id });
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
        Component: () => createElement(AgentKeys, { keys: TWO_KEYS, newKey: null }),
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

// #6648: CopyKey's clipboard write had no .then(onOk, onFail), so a refused
// write (permission denied, insecure context, some in-app browsers) left an
// unhandled rejection and no message on screen, right under the notice that
// says the key is never shown again. The copy boundary, the state the button
// reads and the sentence it shows are the three real app units under test;
// the node project has no DOM, so navigator is stubbed per case exactly as
// tests/unit/share-button.test.ts does (#6619).

const NEW_KEY = "0509_live_secret_value";

let unhandled: unknown[] = [];
function recordUnhandled(reason: unknown): void {
  unhandled.push(reason);
}

// Node reports an unhandled rejection only after the microtask queue drains, so
// every claim below waits for that drain before reading the list. Reading it
// first would make the claim unable to fail.
async function settledUnhandled(): Promise<unknown[]> {
  await new Promise((resolve) => setImmediate(resolve));
  return unhandled;
}

function stubClipboard(writeText: (value: string) => Promise<void>): void {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(writeText) } });
}

beforeEach(() => {
  unhandled = [];
  process.on("unhandledRejection", recordUnhandled);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.off("unhandledRejection", recordUnhandled);
});

describe("copying a new API key", () => {
  it("reports copied and asks the clipboard for the value when the write resolves", async () => {
    const written: string[] = [];
    stubClipboard((value) => {
      written.push(value);
      return Promise.resolve();
    });

    await expect(copyToClipboard(NEW_KEY)).resolves.toBe("copied");

    expect(written).toEqual([NEW_KEY]);
    expect(await settledUnhandled()).toEqual([]);
  });

  it("reports failed instead of rejecting when the browser refuses the write", async () => {
    stubClipboard(() => Promise.reject(new DOMException("write refused", "NotAllowedError")));

    await expect(copyToClipboard(NEW_KEY)).resolves.toBe("failed");

    expect(await settledUnhandled()).toEqual([]);
  });

  // An insecure context or an in-app browser leaves navigator.clipboard absent,
  // so reading .writeText throws before a promise exists. The chain starts from
  // Promise.resolve() so that throw is a rejection the onFail arm handles.
  it("reports failed and raises nothing when navigator.clipboard is absent", async () => {
    vi.stubGlobal("navigator", {});

    await expect(copyToClipboard(NEW_KEY)).resolves.toBe("failed");

    expect(await settledUnhandled()).toEqual([]);
  });

  it("reports failed and raises nothing when reading writeText throws synchronously", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        get writeText() {
          throw new TypeError("writeText is read-only");
        },
      },
    });

    await expect(copyToClipboard(NEW_KEY)).resolves.toBe("failed");

    expect(await settledUnhandled()).toEqual([]);
  });

  it("reads Copied on the button once the write resolved, and keeps its resting label otherwise", () => {
    expect(copyKeyLabel("copied")).toBe("Copied");
    expect(copyKeyLabel("idle")).toBe("Copy key");
    expect(copyKeyLabel("failed")).toBe("Copy key");
  });

  it("says to copy the key by hand after a failed write, as a status the screen reader reads", () => {
    const html = renderToStaticMarkup(createElement(CopyFailureNote, { subject: "key above" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Copy failed. Select the key above and copy it by hand.");
  });

  it("names the connect field instead of pointing above it when a CopyField write fails", () => {
    const html = renderToStaticMarkup(createElement(CopyFailureNote, { subject: "connector address" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Copy failed. Select the connector address and copy it by hand.");
  });

  it("never prints the key when the write is refused", async () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    stubClipboard(() => Promise.reject(new DOMException("write refused", "NotAllowedError")));

    await expect(copyToClipboard(NEW_KEY)).resolves.toBe("failed");

    spy.mockRestore();
    expect(JSON.stringify(logged)).not.toContain("live_secret_value");
  });

  it("shows the resting copy button and no failure sentence on the new-key notice", () => {
    const html = renderToStaticMarkup(createElement(CopyKey, { value: NEW_KEY }));
    expect(html).toContain(copyKeyLabel("idle"));
    expect(html).not.toContain("Copy failed");
  });

  // The failure sentence tells the person to select the key above, so the key
  // has to be on screen in the same notice, above the button. This is the only
  // place CopyKey is rendered.
  it("puts the key on screen above the copy button in the new-key notice", () => {
    const Stub = createRoutesStub([
      { path: "/", Component: () => createElement(AgentKeys, { keys: [], newKey: NEW_KEY }) },
    ]);
    const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
    const key = html.indexOf(`>${NEW_KEY}<`);
    const button = html.indexOf(copyKeyLabel("idle"));
    expect(key).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(key);
    expect(html).toContain("it won&#x27;t be shown again");
  });
});

// The click path end to end: the button's real onClick, the real
// copyToClipboard, the real setState wiring and the real failure render. The
// node project has no DOM, so the button and the state hook are stubbed with
// the same shape tests/competitor/competitor-pending-buttons.test.ts uses for
// useNavigation: the stubbed button hands the harness its onClick, and the
// stubbed useState is a one-slot store so the settled outcome can be rendered
// again. Everything between the click and the second render is the shipped
// code, so deleting `.then(setState)` or the failure note fails these tests.
const clicked = vi.hoisted(() => ({
  state: "idle" as "idle" | "copied" | "failed",
  onClick: null as null | (() => void),
}));

function stubCopyClick(outcome: "resolves" | "rejects"): void {
  vi.resetModules();
  clicked.state = "idle";
  clicked.onClick = null;
  vi.doMock("react", async (importOriginal) => {
    const actual = await importOriginal<typeof ReactModule>();
    return {
      ...actual,
      useState: (): [string, (next: "idle" | "copied" | "failed") => void] => [
        clicked.state,
        (next) => {
          clicked.state = next;
        },
      ],
    };
  });
  vi.doMock("../../app/components/ui/button", () => ({
    Button: (props: { onClick?: () => void; children?: ReactNode }) => {
      clicked.onClick = props.onClick ?? null;
      return createElement("button", { type: "button" }, props.children);
    },
  }));
  stubClipboard(
    outcome === "resolves"
      ? () => Promise.resolve()
      : () => Promise.reject(new DOMException("write refused", "NotAllowedError")),
  );
}

async function clickAndRenderCopyKey(): Promise<string> {
  const { CopyKey: ClickedCopyKey } = await import("../../app/components/agent-settings");
  renderToStaticMarkup(createElement(ClickedCopyKey, { value: NEW_KEY }));
  if (clicked.onClick === null) {
    throw new Error("the copy button rendered no onClick");
  }
  clicked.onClick();
  expect(await settledUnhandled()).toEqual([]);
  return renderToStaticMarkup(createElement(ClickedCopyKey, { value: NEW_KEY }));
}

describe("the copy button wires a refused write to the failure sentence", () => {
  it("shows the resting label and the failure sentence after a refused write", async () => {
    stubCopyClick("rejects");
    const html = await clickAndRenderCopyKey();
    expect(html).toContain(copyKeyLabel("failed"));
    expect(html).toContain("Copy failed. Select the key above and copy it by hand.");
  });

  it("shows Copied and no failure sentence after a write that resolves", async () => {
    stubCopyClick("resolves");
    const html = await clickAndRenderCopyKey();
    expect(html).toContain("Copied");
    expect(html).not.toContain("Copy failed");
  });
});
