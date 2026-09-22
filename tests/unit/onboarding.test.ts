import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  Form: (props: { method?: string; action?: string; children?: React.ReactNode }) =>
    createElement("form", { method: props.method, action: props.action }, props.children),
}));

import { OneInput, type OneInputProps } from "../../app/components/one-input";
import { StepBar, type StepBarProps } from "../../app/components/onboarding/step-bar";

function oneInput(props: Partial<OneInputProps> = {}): string {
  const element: ReactElement | null = createElement(OneInput, {
    label: "your website, or a handle",
    action: "/onboarding",
    ...props,
  });
  return renderToStaticMarkup(element);
}

function stepBar(props: Partial<StepBarProps> = {}): string {
  const element: ReactElement | null = createElement(StepBar, {
    steps: ["one input", "your card", "who you're up against"],
    current: 1,
    ...props,
  });
  return renderToStaticMarkup(element);
}

const NOT_FOUND_LINE = "we couldn&#x27;t find anything for that, try the main website";
const STEPS = ["one input", "your card", "who you're up against"] as const;

describe("the one input", () => {
  it("renders exactly one text field and one submit action", () => {
    const html = oneInput();
    expect(html).toContain('type="text"');
    expect(html).toContain('type="submit"');
    expect(html.match(/<input/g)?.length).toBe(1);
  });

  it("takes its label and its posting action as props, never a variant", () => {
    const html = oneInput({ label: "add one we missed", action: "/app/competitors" });
    expect(html).toContain('placeholder="add one we missed"');
    expect(html).toContain('aria-label="add one we missed"');
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/app/competitors"');
    expect(html).not.toContain("variant");
  });

  it("carries a prefilled value without owning how it got there", () => {
    const html = oneInput({ defaultValue: "@loopwellhq" });
    expect(html).toContain('value="@loopwellhq"');
  });

  it("shows one line and no error page when nothing was found", () => {
    const html = oneInput({ notFound: true });
    expect(html).toContain(NOT_FOUND_LINE);
    expect(html.match(/<p/g)?.length).toBe(1);
    expect(html).not.toContain("<h1");
  });

  it("keeps the screen quiet when something was found", () => {
    const html = oneInput();
    expect(html).not.toContain(NOT_FOUND_LINE);
    expect(html.match(/<p/g)?.length ?? 0).toBe(0);
  });

  it("names the field for a screen reader without a visible label element", () => {
    const html = oneInput();
    expect(html).toContain('aria-label="your website, or a handle"');
    expect(html).not.toContain("<label");
  });
});

describe("the onboarding step bar", () => {
  it("renders every step as one mono row with the arrows between them", () => {
    const html = stepBar();
    for (const step of STEPS) {
      expect(html).toContain(step.replace(/'/g, "&#x27;"));
    }
    expect(html.match(/-&gt;/g)?.length).toBe(2);
    expect(html).toContain("font-mono");
    expect(html).toContain("uppercase");
  });

  it("puts the current step on the green marker and every other step in ink", () => {
    for (const [index, step] of STEPS.entries()) {
      const html = stepBar({ current: index + 1 });
      const marker = /class="([^"]*bg-accent[^"]*)"[^>]*>([^<]*)</.exec(html);
      expect(marker?.[1]).toContain("bg-accent");
      expect(marker?.[2]).toContain(step.replace(/'/g, "&#x27;"));
      // The non-current spans carry text-ink; a bare `toContain("text-ink")` is
      // vacuous because the nav wrapper itself contains `text-ink-faint`.
      const others = html.replace(/class="[^"]*bg-accent[^"]*"[^>]*>[^<]*</, "");
      expect(others).toContain("font-semibold text-ink");
    }
  });

  it("hides the arrows from a screen reader", () => {
    const html = stepBar();
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders from one component for all three screens, with no per-screen variant", () => {
    // The real invariant is that the route modules *choose* `current` and pass
    // it in — not that three different numbers produce three different
    // strings, which is trivially true. Read the route files and assert both
    // screens share this component.
    const routes = ["app/routes/onboarding._index.tsx", "app/routes/onboarding.identity.tsx"];
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('from "../components/onboarding/step-bar"');
      expect(source).toContain("<StepBar");
      expect(source).not.toContain("variant");
    }
  });

  it("reports each not-found submit with a fresh key, so a repeat submit refocuses", () => {
    // The boolean alone cannot tell the second whitespace submit from the
    // first; the route's action stamps a monotonic key the component depends
    // on, and "the input stays focused" needs that re-run.
    const route = readFileSync("app/routes/onboarding._index.tsx", "utf8");
    expect(route).toContain("submitId");
    expect(route).toContain("notFoundKey");
  });

  it("keeps the not-found branch free of any second normaliser", () => {
    // docs/REBUILD-ONBOARDING.md step 2 and the identity-card engine own
    // normalisation; screen 1 only trims and passes the raw subject through.
    const route = readFileSync("app/routes/onboarding._index.tsx", "utf8");
    const action = /export async function action[\s\S]*?\n}/.exec(route)?.[0] ?? "";
    expect(action).toContain(".trim()");
    expect(action).toContain('redirect(`/onboarding/identity?input=');
    expect(action).not.toContain("normalise");
    expect(action).not.toContain("tldts");
    expect(action).not.toContain("URL(");
  });

  it("passes the raw subject through, so the identity route owns the URL shape", () => {
    const route = readFileSync("app/routes/onboarding._index.tsx", "utf8");
    const action = /export async function action[\s\S]*?\n}/.exec(route)?.[0] ?? "";
    expect(action).toContain("encodeURIComponent(input)");
  });
});
