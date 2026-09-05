import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function mockReactRouter() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

async function renderAuthForm(props: {
  mode: "login" | "signup";
  redirectTo: string;
  initialEmail?: string;
  initialName?: string;
  linkSent?: boolean;
}) {
  mockReactRouter();
  const { AuthForm } = await import("~/components/auth-form");
  return renderToStaticMarkup(createElement(AuthForm, props));
}

describe("AuthForm signup-mode next-step and deliverability guidance", () => {
  it("tells signup visitors before send that the setup link goes to their email and what to do if it is slow or in spam", async () => {
    const markup = await renderAuthForm({ mode: "signup", redirectTo: "/app" });

    // The email next step is stated in plain words before submit.
    expect(markup).toContain("send a setup link to that inbox");
    expect(markup).toContain("open it to verify and create the account");
    // Deliverability guidance: timing + spam/promotions fallback before resending.
    expect(markup).toContain("The link usually arrives within a minute or two");
    expect(markup).toContain("check spam or promotions");
    expect(markup).toContain("Send setup link");
    // Labels are real <label>/<span> text, not placeholders.
    expect(markup).toContain("<span>Name</span>");
    expect(markup).toContain("<span>Email</span>");
    expect(markup).toContain("placeholder=\"Your name\"");
    expect(markup).toContain("placeholder=\"you@company.com\"");
  });

  it("keeps the check-your-email + spam guidance visible on the post-send recovery state", async () => {
    const markup = await renderAuthForm({
      mode: "signup",
      redirectTo: "/app",
      initialEmail: "owner@example.com",
      initialName: "Owner",
      linkSent: true,
    });

    expect(markup).toContain("Check your email");
    expect(markup).toContain("Link sent to <strong>owner@example.com</strong>");
    expect(markup).toContain("Open the setup link to verify and create the account");
    expect(markup).toContain("check spam or promotions");
    expect(markup).toContain("Resend link");
  });

  it("does not leak signup-only spam guidance into login-mode copy", async () => {
    const markup = await renderAuthForm({ mode: "login", redirectTo: "/app" });

    expect(markup).toContain("Send sign-in link");
    expect(markup).toContain("send a one-time link to your inbox");
    expect(markup).not.toContain("check spam or promotions");
    expect(markup).not.toContain("setup link");
  });
});
