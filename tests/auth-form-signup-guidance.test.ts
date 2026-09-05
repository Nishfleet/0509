import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

function mockReactRouter() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderAuthForm(props: Record<string, unknown>): Promise<string> {
  mockReactRouter();
  const { AuthForm } = await import("~/components/auth-form");
  return renderToStaticMarkup(createElement(AuthForm, props));
}

describe("AuthForm signup-mode next-step guidance", () => {
  it("tells signup visitors to check their inbox and what to do if the mail is slow or in spam", async () => {
    const markup = await renderAuthForm({ mode: "signup", redirectTo: "/app#setup-checklist" });

    expect(markup).toContain("Send setup link");
    expect(markup).toContain("check your inbox for the setup link");
    expect(markup).toContain("spam and promotions");
  });

  it("restates the next step and the spam guidance after the setup link is sent", async () => {
    const markup = await renderAuthForm({
      mode: "signup",
      redirectTo: "/app#setup-checklist",
      initialEmail: "owner@example.com",
      initialName: "Nish",
      linkSent: true,
    });

    expect(markup).toContain("Check your email");
    expect(markup).toContain("We sent a setup link");
    expect(markup).toContain("spam and promotions");
    expect(markup).toContain("Resend link");
  });

  it("does not show the pre-submit form inside the post-send recovery state", async () => {
    const markup = await renderAuthForm({
      mode: "signup",
      redirectTo: "/app#setup-checklist",
      initialEmail: "owner@example.com",
      initialName: "Nish",
      linkSent: true,
    });

    expect(markup).not.toContain("Send setup link");
    expect(markup).not.toContain("check your inbox for the setup link");
  });

  it("leaves login-mode copy untouched and free of signup-only guidance", async () => {
    const markup = await renderAuthForm({ mode: "login", redirectTo: "/app" });

    expect(markup).toContain("Send sign-in link");
    expect(markup).toContain("we&#x27;ll send a one-time link to your inbox.");
    expect(markup).not.toContain("setup link");
    expect(markup).not.toContain("spam");
  });

  it("keeps visible fields labelled with real text, not placeholder-only labels", async () => {
    const markup = await renderAuthForm({ mode: "signup", redirectTo: "/app#setup-checklist" });

    expect(markup).toContain('class="f9-field"');
    expect(markup).toContain("<span>Name</span>");
    expect(markup).toContain("<span>Email</span>");
    expect(markup).toContain('placeholder="Your name"');
    expect(markup).toContain('placeholder="you@company.com"');
  });
});
