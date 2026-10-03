import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import Page from "../../app/routes/onboarding.competitors";

const NEVER = () => new Promise(() => undefined);

type RouteProps = Parameters<typeof Page>[0];
const LOADER_DATA: RouteProps["loaderData"] = { on: [], maybes: [], discovery: "done" };

function render(submission: { intent: string } | null): string {
  const router = createMemoryRouter(
    [
      {
        id: "onboarding",
        path: "/onboarding/competitors",
        // The screen reads the loader's data, as hydration passes it.
        Component: () => createElement(Page, { loaderData: LOADER_DATA }),
        action: NEVER,
      },
    ],
    { initialEntries: ["/onboarding/competitors"] },
  );
  if (submission !== null) {
    const formData = new FormData();
    formData.set("intent", submission.intent);
    void router.navigate("/onboarding/competitors", { formMethod: "post", formData });
  }
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function button(html: string, label: string): string {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const found = buttons.find((candidate) => candidate.includes(`>${label}</button>`));
  if (found === undefined) throw new Error(`no ${label} button in the rendered screen`);
  return found;
}

describe("the /onboarding/competitors Start watching button", () => {
  it("stays live and unlabelled as pending when nothing is submitting", () => {
    const html = render(null);

    expect(button(html, "Start watching")).not.toContain('disabled=""');
    expect(html).toContain(">Start watching</button>");
    expect(html).not.toContain("Starting");
  });

  it("disables and reads Starting… while the start submission is in flight", () => {
    const html = render({ intent: "start" });

    expect(button(html, "Starting…")).toContain('disabled=""');
    expect(html).not.toContain(">Start watching</button>");
  });

  it("stays live while AddCompetitor submits, and is not labelled as starting", () => {
    const html = render({ intent: "add" });

    expect(button(html, "Adding…")).toContain('disabled=""');
    expect(button(html, "Start watching")).not.toContain('disabled=""');
    expect(html).not.toContain("Starting");
  });
});
