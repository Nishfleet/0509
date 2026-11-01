import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import type { Navigation } from "react-router";
import type * as ReactRouterModule from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OneInput } from "../../app/components/one-input";

const harness = vi.hoisted(() => ({
  state: "idle" as Navigation["state"],
  formAction: undefined as string | undefined,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useNavigation: () => ({ state: harness.state, formAction: harness.formAction }) };
});

function inRouter(element: ReturnType<typeof createElement>): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

const PARENT_COPY = "we couldn't find a website or username in that";

function markup(message?: string): string {
  return inRouter(
    createElement(OneInput, {
      label: "your website address or social username (like @yourbrand)",
      placeholder: "your website address or social username (like @yourbrand)",
      name: "subject",
      action: "/onboarding",
      message,
      submitLabel: "Continue",
    }),
  );
}

describe("OneInput", () => {
  beforeEach(() => {
    harness.state = "idle";
    harness.formAction = undefined;
  });

  it("disables its button and marks the form busy while its own submit is in flight", () => {
    harness.state = "submitting";
    harness.formAction = "/onboarding";
    const html = markup();
    expect(html).toMatch(/<button\b[^>]*\sdisabled(?:=|\s|>)/);
    expect(html).toContain('aria-busy="true"');
  });

  it("stays live when another form is the one submitting", () => {
    harness.state = "submitting";
    harness.formAction = "/app/competitors";
    expect(markup()).not.toMatch(/<button\b[^>]*\sdisabled(?:=|\s|>)/);
  });

  it("swaps to the pending label and disables repeat taps while a GET to its action is loading", () => {
    harness.state = "loading";
    harness.formAction = "/login";
    const html = inRouter(
      createElement(OneInput, {
        label: "your website address or social username (like @yourbrand)",
        placeholder: "yoursite.com or @yourbrand",
        name: "subject",
        action: "/login",
        method: "get",
        submitLabel: "Start watching",
        pendingLabel: "Starting…",
      }),
    );
    expect(html).toMatch(/<button\b[^>]*\sdisabled(?:=|\s|>)/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Starting…");
    expect(html).not.toContain("Start watching");
  });

  it("keeps its own label and stays live while a GET to another action is loading", () => {
    harness.state = "loading";
    harness.formAction = "/pricing";
    const html = inRouter(
      createElement(OneInput, {
        label: "your website address or social username (like @yourbrand)",
        placeholder: "yoursite.com or @yourbrand",
        name: "subject",
        action: "/login",
        method: "get",
        submitLabel: "Start watching",
        pendingLabel: "Starting…",
      }),
    );
    expect(html).not.toMatch(/<button\b[^>]*\sdisabled(?:=|\s|>)/);
    expect(html).not.toContain('aria-busy="true"');
    expect(html).toContain("Start watching");
    expect(html).not.toContain("Starting…");
  });

  it("keeps the submit label while busy when no pending label is given", () => {
    harness.state = "submitting";
    harness.formAction = "/onboarding";
    const html = markup();
    expect(html).toMatch(/<button\b[^>]*\sdisabled(?:=|\s|>)/);
    expect(html).toContain("Continue");
  });

  it("posts to the given action and carries the given input attributes", () => {
    const html = markup();
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/onboarding"');
    expect(html).toContain('name="subject"');
    expect(html).toContain('placeholder="your website address or social username (like @yourbrand)"');
    expect(html).toMatch(
      /<label for="([^"]+)"[^>]*>your website address or social username \(like @yourbrand\)<\/label>/,
    );
    const labelFor = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${labelFor}"`);
    expect(html).not.toContain("aria-label=");
    expect(html).not.toContain("required");
  });

  it("leaves a typed domain or handle as typed on a phone keyboard", () => {
    const html = markup();
    expect(html).toContain('autoCapitalize="none"');
    expect(html).toContain('autoCorrect="off"');
    expect(html).toContain('spellCheck="false"');
  });

  it("shows the parent copy line as a status when message is set", () => {
    const html = markup(PARENT_COPY);
    expect(html).toContain('role="status"');
    expect(html).toContain("find a website or username in that");
    expect(html).toContain('aria-describedby="one-input-message"');
    expect(html).toContain('id="one-input-message"');
  });

  it("carries a visible submit button, so the form is not Enter-only", () => {
    expect(markup()).toMatch(/<button[^>]*type="submit"[^>]*>Continue<\/button>/);
  });

  it("renders no status when message is absent", () => {
    const html = markup();
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('aria-describedby="one-input-message"');
    expect(html).not.toContain('id="one-input-message"');
  });

  it("can GET, require the field, and label the submit with a node", () => {
    const html = inRouter(
      createElement(OneInput, {
        label: "your website address or social username (like @yourbrand)",
        placeholder: "your website address or social username (like @yourbrand)",
        name: "subject",
        action: "/login",
        method: "get",
        required: true,
        maxLength: 200,
        submitLabel: createElement("span", null, "€10/month"),
      }),
    );
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/login"');
    expect(html).toContain("required");
    expect(html).toContain('maxLength="200"');
    expect(html).toContain("€10/month");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>/);
  });
});
