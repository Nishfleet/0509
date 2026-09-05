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

describe("AuthForm signup next-step guidance (magic link)", () => {
  it("states the setup-link next step and spam guidance before sending", async () => {
    mockReactRouter();

    const { AuthForm } = await import("~/components/auth-form");
    const markup = renderToStaticMarkup(
      createElement(AuthForm, { mode: "signup", redirectTo: "/app#setup-checklist" }),
    );

    expect(markup).toContain("Send setup link");
    // Next-step preview in plain words: a setup link arrives by email…
    expect(markup).toContain("email a setup link");
    // …and what to do if mail is slow or lands in spam.
    expect(markup).toContain("check that inbox");
    expect(markup).toContain("spam and promotions folders");
    // Visible labels are real <span> text inside <label>, not placeholder-only.
    expect(markup).toContain("<span>Name</span>");
    expect(markup).toContain("<span>Email</span>");
    // Still the email magic-link flow only: no password field, no invented OAuth.
    expect(markup).not.toContain("type=\"password\"");
    expect(markup).not.toContain("Continue with Google");
  });

  it("repeats the next step and slow/spam recovery after the setup link is sent", async () => {
    mockReactRouter();

    const { AuthForm } = await import("~/components/auth-form");
    const markup = renderToStaticMarkup(
      createElement(AuthForm, {
        mode: "signup",
        redirectTo: "/app#setup-checklist",
        initialEmail: "owner@example.com",
        initialName: "Owner",
        linkSent: true,
      }),
    );

    expect(markup).toContain("Check your email");
    expect(markup).toContain("We sent a setup link to that inbox");
    expect(markup).toContain("spam and promotions folders");
    expect(markup).toContain("Resend link");
    expect(markup).toContain("Use a different email");
    expect(markup).not.toContain("Send setup link");
  });

  it("keeps login-mode copy truthful and unchanged in spirit", async () => {
    mockReactRouter();

    const { AuthForm } = await import("~/components/auth-form");
    const markup = renderToStaticMarkup(
      createElement(AuthForm, { mode: "login", redirectTo: "/app" }),
    );

    expect(markup).toContain("Send sign-in link");
    expect(markup).toContain("a one-time link to your inbox");
    expect(markup).not.toContain("Send setup link");
    expect(markup).not.toContain("spam and promotions folders");
  });
});
