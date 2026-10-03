import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import type { Navigation } from "react-router";
import type * as ReactRouterModule from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsentView } from "../../app/lib/agent/consent.server";

vi.mock("../../app/lib/agent/consent.server", () => ({
  decideConsent: () => Promise.resolve(),
  readConsent: () => Promise.resolve(),
}));

vi.mock("../../app/lib/require-session.server", () => ({
  requireFreshSession: () => Promise.resolve(),
}));

import Page from "../../app/routes/oauth.authorize";

// The consent form posts with two plain submit buttons, so the only place the
// pending state comes from is the router's navigation. The harness replaces
// useNavigation for the pending states only, the same shape the unsubscribe and
// verify-address route tests use (tests/unit/unsubscribe-route.test.ts).
const harness = vi.hoisted(() => ({
  state: "idle" as Navigation["state"],
  decision: null as string | null,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<ReactRouterModule>();
  return {
    ...actual,
    useNavigation: (...args: Parameters<typeof actual.useNavigation>): Navigation => {
      if (harness.state === "idle") return actual.useNavigation(...args);
      const formData = new FormData();
      if (harness.decision !== null) formData.set("decision", harness.decision);
      return {
        state: harness.state,
        location: { pathname: "/oauth/authorize", search: "", hash: "", state: null, key: "k" },
        matches: [],
        historyAction: "POP",
        formMethod: "post",
        formAction: "/oauth/authorize",
        formEncType: "application/x-www-form-urlencoded",
        formData,
        json: undefined,
        text: undefined,
      } as Navigation;
    },
  };
});

const ASK: ConsentView = { kind: "ask", host: "app.example", claimedName: "Test App" };

function renderPage(view: ConsentView): string {
  const Stub = createRoutesStub([{ id: "routes/oauth.authorize", path: "/oauth/authorize", Component: Page }]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: ["/oauth/authorize"],
      hydrationData: { loaderData: { "routes/oauth.authorize": view } },
    }),
  );
}

function buttonFor(html: string, decision: "allow" | "deny"): string {
  const buttons = html.match(/<button[\s\S]*?<\/button>/g) ?? [];
  const match = buttons.find((button) => button.includes(`value="${decision}"`));
  if (match === undefined) throw new Error(`no ${decision} button in ${html}`);
  return match;
}

function renderPending(state: Exclude<Navigation["state"], "idle">, decision: string | null = null): string {
  harness.state = state;
  harness.decision = decision;
  return renderPage(ASK);
}

describe("/oauth/authorize consent buttons (0509#6759)", () => {
  beforeEach(() => {
    harness.state = "idle";
    harness.decision = null;
  });

  it("shows Allow and Cancel, both live, while nothing is in flight", () => {
    const html = renderPage(ASK);

    expect(buttonFor(html, "allow")).toContain("Allow");
    expect(buttonFor(html, "deny")).toContain("Cancel");
    expect(buttonFor(html, "allow")).not.toContain('disabled=""');
    expect(buttonFor(html, "deny")).not.toContain('disabled=""');
    expect(html).not.toContain("Allowing…");
  });

  it("disables both buttons and reads Allowing… while the allow decision posts", () => {
    const html = renderPending("submitting", "allow");

    expect(buttonFor(html, "allow")).toContain("Allowing…");
    expect(buttonFor(html, "allow")).toContain('disabled=""');
    expect(buttonFor(html, "deny")).toContain("Cancel");
    expect(buttonFor(html, "deny")).toContain('disabled=""');
  });

  it("disables both buttons while the deny decision posts, and keeps Allow", () => {
    const html = renderPending("submitting", "deny");

    expect(buttonFor(html, "allow")).toContain("Allow");
    expect(buttonFor(html, "allow")).not.toContain("Allowing…");
    expect(buttonFor(html, "allow")).toContain('disabled=""');
    expect(buttonFor(html, "deny")).toContain('disabled=""');
  });

  it("keeps both buttons disabled while the navigation settles with no form in flight", () => {
    const html = renderPending("loading");

    expect(buttonFor(html, "allow")).toContain('disabled=""');
    expect(buttonFor(html, "deny")).toContain('disabled=""');
  });
});
