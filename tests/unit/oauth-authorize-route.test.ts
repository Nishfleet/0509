import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { Navigation } from "react-router";
import type * as ReactRouterModule from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsentView } from "../../app/lib/agent/consent.server";

vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("../../app/lib/agent/consent.server", () => ({
  decideConsent: () =>
    Promise.resolve({
      kind: "error",
      message: "This connection link doesn't work",
    } satisfies ConsentView),
  readConsent: () => Promise.resolve(),
}));

vi.mock("../../app/lib/require-session.server", () => ({
  requireFreshSession: () => Promise.resolve(),
}));

import Page from "../../app/routes/oauth.authorize";

// Two submit buttons share the one consent form, so the pending state comes from
// the router's navigation alone. The harness stands in for that navigation, the
// same shape the unsubscribe, verify-address and competitor pending-state tests
// use (tests/unit/unsubscribe-route.test.ts, tests/unit/verify-address-route.test.ts,
// tests/competitor/competitor-pending-buttons.test.ts).
//
// React Router keeps the submission's formData from "submitting" through the
// "loading" that follows it and drops it only at "idle", so the harness carries
// the decision on both states that hold a submission.
const harness = vi.hoisted(() => ({
  state: "idle" as Navigation["state"],
  decision: null as string | null,
  formData(): FormData | undefined {
    if (harness.decision === null) return undefined;
    const data = new FormData();
    data.set("decision", harness.decision);
    return data;
  },
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<ReactRouterModule>();
  return {
    ...actual,
    // The stub's own navigation is idle, so only the pending states are
    // replaced. Every other test in this file keeps the real hook.
    useNavigation: (...args: Parameters<typeof actual.useNavigation>): Navigation =>
      harness.state === "idle"
        ? actual.useNavigation(...args)
        : ({
            state: harness.state,
            location: { pathname: "/oauth/authorize", search: "", hash: "", state: null, key: "k" },
            matches: [],
            historyAction: "POP",
            formMethod: "post",
            formAction: "/oauth/authorize",
            formEncType: "application/x-www-form-urlencoded",
            formData: harness.formData(),
            json: undefined,
            text: undefined,
          } as Navigation),
  };
});

const ASK: ConsentView = { kind: "ask", host: "app.example", claimedName: "Test App" };

const NEVER = () => new Promise(() => undefined);

// The action never settles in this harness, so the router stays in the state the
// submission put it in and the screen renders that state for real -- the same
// device tests/unit/onboarding-start-pending.test.ts uses.
function renderPage(submission: { decision: string } | null, loaderData: ConsentView): string {
  const router = createMemoryRouter(
    [
      {
        id: "oauth.authorize",
        path: "/oauth/authorize",
        Component: () => createElement(Page, { loaderData, actionData: undefined }),
        action: NEVER,
      },
    ],
    { initialEntries: ["/oauth/authorize"] },
  );
  if (submission !== null) {
    const formData = new FormData();
    formData.set("decision", submission.decision);
    void router.navigate("/oauth/authorize", { formMethod: "post", formData });
  }
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function render(state: Exclude<Navigation["state"], "idle">, decision: string | null = null): string {
  harness.state = state;
  harness.decision = decision;
  return renderPage(null, ASK);
}

// The button's own class list carries `disabled:pointer-events-none`, so the
// attribute is matched on its own and not as a substring of the class string.
function isDisabled(button: string): boolean {
  const tag = button.match(/<button\b[^>]*>/)?.[0] ?? "";
  return /(?:^|\s)disabled(?:\s|>|=|$)/.test(tag);
}

function label(button: string): string {
  const text = button.replace(/<[^>]*>/g, "");
  return text;
}

function buttonFor(html: string, decision: "allow" | "deny"): string {
  const buttons = html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
  const found = buttons.find((button) => button.includes(`value="${decision}"`));
  if (found === undefined) throw new Error(`no ${decision} button in ${html}`);
  return found;
}

function allow(html: string): string {
  return buttonFor(html, "allow");
}

function deny(html: string): string {
  return buttonFor(html, "deny");
}

describe("/oauth/authorize consent buttons (0509#6759)", () => {
  beforeEach(() => {
    harness.state = "idle";
    harness.decision = null;
  });

  it("shows Allow and Cancel, both live, while nothing is in flight", () => {
    const html = renderPage(null, ASK);

    expect(label(allow(html))).toBe("Allow");
    expect(label(deny(html))).toBe("Cancel");
    expect(isDisabled(allow(html))).toBe(false);
    expect(isDisabled(deny(html))).toBe(false);
  });

  it("disables both buttons and reads Allowing… while the allow decision posts", () => {
    // The post itself, on the real stub router: the pending state a second tap
    // would have submitted into is what the state and label carry here.
    const html = renderPage({ decision: "allow" }, ASK);

    expect(isDisabled(allow(html))).toBe(true);
    expect(isDisabled(deny(html))).toBe(true);
    expect(label(allow(html))).toBe("Allowing…");
    expect(label(deny(html))).toBe("Cancel");
  });

  it("disables both buttons while the deny decision posts, and keeps Allow", () => {
    const html = renderPage({ decision: "deny" }, ASK);

    expect(isDisabled(allow(html))).toBe(true);
    expect(isDisabled(deny(html))).toBe(true);
    expect(label(allow(html))).toBe("Allow");
    expect(label(deny(html))).toBe("Cancel");
  });

  it("keeps both buttons disabled while the navigation settles after the post", () => {
    const html = render("loading", "allow");

    expect(isDisabled(allow(html))).toBe(true);
    expect(isDisabled(deny(html))).toBe(true);
    expect(label(allow(html))).toBe("Allowing…");
  });

  it("keeps Allow's own label while a revalidation runs with no form in flight", () => {
    const html = render("loading");

    expect(isDisabled(allow(html))).toBe(true);
    expect(isDisabled(deny(html))).toBe(true);
    expect(label(allow(html))).toBe("Allow");
  });
});
