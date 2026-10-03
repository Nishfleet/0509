import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { IncidentBlock, IncidentSlot, type IncidentBlockProps } from "../../app/components/incident-block";

const NEVER = () => new Promise(() => undefined);

function props(): IncidentBlockProps {
  return {
    alertId: "alt_42",
    title: "Homepage is 500ing",
    kind: "500 Internal Server Error",
    url: "https://example.com/",
    openedLabel: "five minutes ago",
    recheckAt: "2026-09-25T11:00:00.000Z",
    recheckLabel: "11:00 UTC",
  };
}

function render(overrides: Partial<IncidentBlockProps> = {}, submitting = false): string {
  const block = createElement(IncidentBlock, { ...props(), ...overrides });
  const router = createMemoryRouter([{ path: "/app/alerts", element: block, action: NEVER }], {
    initialEntries: ["/app/alerts"],
  });
  if (submitting) {
    const formData = new FormData();
    formData.set("intent", "acknowledge");
    formData.set("alertId", props().alertId);
    void router.navigate("/app/alerts", { formMethod: "post", formData });
  }
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("the incident block", () => {
  it("renders the eyebrow, the title, the evidence, the re-check time and the two actions", () => {
    const html = render();
    expect(html).toContain("OPEN PROBLEM");
    expect(html).toContain("var(--color-red)");
    expect(html).toContain("Homepage is 500ing");
    expect(html).toContain("500 Internal Server Error");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("Open your site");
    expect(html).toContain('name="intent"');
    expect(html).toContain('value="acknowledge"');
    expect(html).toContain("alt_42");
    expect(html).toContain("I meant to do this");
    expect(html).toContain("2026-09-25T11:00:00.000Z");
    expect(html).toContain("Why we flagged this");
  });

  it("keeps the eyebrow above a title in the house row-name type", () => {
    const html = render();
    expect(html).toContain(
      '<h2 id="incident-block-title" class="mt-2 font-display text-row-name font-bold [overflow-wrap:anywhere]">',
    );
    expect(html).not.toContain("text-lg font-semibold");
  });

  it("submits through the router so a click never reloads the page", () => {
    const html = render();
    expect(html).toContain('<form data-discover="true" action="/app/alerts" method="post">');
  });

  it("disables the acknowledge button and reads Saving… while that alert submits", () => {
    const html = render({}, true);
    const button = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(button).toContain('disabled=""');
    expect(button).toContain("Saving…");
    expect(button).not.toContain("I meant to do this");
  });

  it("leaves the acknowledge button enabled and idle until something submits", () => {
    const button = render().match(/<button\b[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(button).not.toContain('disabled=""');
    expect(button).toContain("I meant to do this");
    expect(button).not.toContain("Saving…");
  });

  it("tells a screen reader the site link leaves the page, in the same anchor", () => {
    const anchor = render().match(/<a\b[^>]*href="https:\/\/example\.com\/"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('Open your site →<span class="sr-only"> (opens in a new tab)</span>');
  });

  it("does not leak probability, a question id or Jev wording", () => {
    const html = render();
    expect(html).not.toContain("%");
    expect(html).not.toContain("p=");
    expect(html).not.toContain("question");
  });
});

describe("the incident slot", () => {
  function slot(incident: IncidentBlockProps | null): string {
    const element = createElement(IncidentSlot, { incident });
    const router = createMemoryRouter([{ path: "/app/alerts", element }], { initialEntries: ["/app/alerts"] });
    return renderToStaticMarkup(createElement(RouterProvider, { router }));
  }

  it("is always in the DOM and empty when there is no incident", () => {
    const html = slot(null);
    expect(html).toContain('data-testid="incident-live"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("OPEN PROBLEM");
  });

  it("announces the incident without stealing focus", () => {
    const html = slot(props());
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("OPEN PROBLEM");
    expect(html.toLowerCase()).not.toContain("tabindex");
    expect(html.toLowerCase()).not.toContain("autofocus");
  });
});
