import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

/**
 * Signup-mode AuthForm must tell a visitor in plain words what happens next:
 * a setup link arrives by email, and what to do when the mail is slow or
 * lands in spam. Login-mode copy must stay untouched.
 */
async function mockReactRouter() {
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

async function renderAuthForm(props: {
  mode: "login" | "signup";
  linkSent?: boolean;
  initialEmail?: string;
  redirectTo?: string;
}) {
  const { AuthForm } = await import("~/components/auth-form");
  return renderToStaticMarkup(
    createElement(AuthForm, {
      mode: props.mode,
      redirectTo: props.redirectTo ?? "/app#setup-checklist",
      ...(props.linkSent ? { linkSent: true, initialEmail: props.initialEmail ?? "new@example.com" } : {}),
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("AuthForm signup next-step guidance", () => {
  it("signup form previews the email setup-link step before submit", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({ mode: "signup" });

    expect(markup).toContain("Send setup link");
    // Plain-words next step: the setup link arrives by email and must be opened.
    expect(markup).toContain("send a setup link to that inbox");
    expect(markup).toContain("open it to verify");
    expect(markup).toContain("add a competitor and start tracking");
  });

  it("signup form keeps visible labels as real label/span text", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({ mode: "signup" });

    expect(markup).toContain("<label");
    expect(markup).toContain("<span>Name</span>");
    expect(markup).toContain("<span>Email</span>");
  });

  it("post-send recovery tells signup users to check email and what to do when mail is slow or in spam", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({ mode: "signup", linkSent: true, initialEmail: "new@example.com" });

    expect(markup).toContain("Check your email");
    expect(markup).toContain("Link sent to");
    expect(markup).toContain("<strong>new@example.com</strong>");
    expect(markup).toContain("It usually arrives within a minute");
    expect(markup).toContain("check your spam and promotions folders");
    expect(markup).toContain("Resend link");
  });

  it("post-send recovery does not leak the spam guidance into login mode", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({ mode: "login", linkSent: true, initialEmail: "user@example.com" });

    expect(markup).toContain("If an account exists for that address, the sign-in link is on the way.");
    expect(markup).toContain("Resend link");
    expect(markup).not.toContain("spam and promotions folders");
    expect(markup).not.toContain("Send setup link");
  });

  it("login mode copy is not rewritten by the signup guidance", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({ mode: "login" });

    expect(markup).toContain("Send sign-in link");
    expect(markup).toContain("a one-time link to your inbox.");
    expect(markup).not.toContain("send a setup link to that inbox");
    expect(markup).not.toContain("spam and promotions folders");
  });
});
