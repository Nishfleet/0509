import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { redirect, requireSessionCalls } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  requireSessionCalls: { count: 0 },
}));

vi.mock("react-router", () => ({
  redirect,
  Form: (props: { method?: string; action?: string; children?: React.ReactNode }) =>
    createElement("form", { method: props.method, action: props.action }, props.children),
  useNavigation: () => ({ state: "idle" }),
}));

vi.mock("../../app/lib/require-session.server", () => ({
  requireSession: async () => {
    requireSessionCalls.count += 1;
    return { user: { id: "user-1", email: "someone@0509.io" } };
  },
}));

vi.mock("../../app/lib/workspace.server", () => ({
  workspaceLandingForRequest: async () => "/onboarding",
}));

import { OneInput, type OneInputProps } from "../../app/components/one-input";
import { StepBar, type StepBarProps } from "../../app/components/onboarding/step-bar";
import { action, loader } from "../../app/routes/onboarding._index";

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

function submit(subject: string | null): Promise<unknown> {
  const form = new FormData();
  if (subject !== null) form.set("subject", subject);
  const request = new Request("https://0509.io/onboarding", { method: "POST", body: form });
  return Promise.resolve(action({ request, params: {} })).catch((thrown: unknown) => thrown);
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
  });

  it("leaves the empty submit to the action, not to the browser", () => {
    expect(oneInput()).not.toContain("required");
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

describe("the onboarding action", () => {
  it("trims the subject and redirects to the identity screen with it encoded", async () => {
    const result = await submit("  loopwell.com  ");
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(
      "redirect:/onboarding/identity?input=loopwell.com",
    );
  });

  it("encodes a handle, so the identity route owns the URL shape", async () => {
    const result = await submit("@loopwellhq");
    expect((result as Error).message).toBe(
      "redirect:/onboarding/identity?input=%40loopwellhq",
    );
  });

  it("answers an empty submit with the not-found branch, once, and never a redirect", async () => {
    const result = await submit("   ");
    expect(result).toEqual({ notFound: true });
  });

  it("answers a missing field the same way as an empty one", async () => {
    const result = await submit(null);
    expect(result).toEqual({ notFound: true });
  });

  it("requires a session before it reads the subject", async () => {
    const before = requireSessionCalls.count;
    await submit("loopwell.com");
    expect(requireSessionCalls.count).toBe(before + 1);
  });
});

describe("the onboarding loader", () => {
  it("returns normally for a workspace with no self entity", async () => {
    const request = new Request("https://0509.io/onboarding");
    await expect(loader({ request, params: {} })).resolves.toBeNull();
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
      const others = html.replace(/class="[^"]*bg-accent[^"]*"[^>]*>[^<]*</, "");
      expect(others).toContain("font-semibold text-ink");
    }
  });

  it("hides the arrows from a screen reader", () => {
    const html = stepBar();
    expect(html).toContain('aria-hidden="true"');
  });
});
