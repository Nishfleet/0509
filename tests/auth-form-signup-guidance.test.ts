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
  linkResent?: boolean;
  initialEmail?: string;
  initialName?: string;
  initialCompetitor?: string;
  redirectTo?: string;
}) {
  const { AuthForm } = await import("~/components/auth-form");
  return renderToStaticMarkup(
    createElement(AuthForm, {
      mode: props.mode,
      redirectTo: props.redirectTo ?? "/app#setup-checklist",
      ...(props.initialCompetitor !== undefined ? { initialCompetitor: props.initialCompetitor } : {}),
      ...(props.linkSent
        ? {
            linkSent: true,
            initialEmail: props.initialEmail ?? "new@example.com",
            ...(props.linkResent ? { linkResent: true } : {}),
            ...(props.initialName !== undefined ? { initialName: props.initialName } : {}),
          }
        : {}),
    }),
  );
}

function mockSignupActionModules(sendBetterAuthMagicLink: ReturnType<typeof vi.fn>) {
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
  vi.doMock("~/lib/better-auth.server", () => ({
    isBetterAuthConfigured: vi.fn(() => true),
    isSameOriginAuthFormPost: vi.fn(() => true),
    sendBetterAuthMagicLink,
  }));
  vi.doMock("~/lib/funnel-measurement.server", () => ({
    emitFunnelSignupStartFromAllowlistedSource: vi.fn(),
  }));
  vi.doMock("~/lib/signup-source", () => ({
    allowlistedSignupSource: vi.fn(() => null),
    rememberAllowlistedSignupSource: vi.fn().mockResolvedValue(null),
    signupSourceCookieHeader: vi.fn(() => ""),
    signupSourceFromRequest: vi.fn(() => null),
  }));
}

function actionArgs(request: Request) {
  return { context: { cloudflare: { env: {} } }, request } as never;
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

describe("AuthForm signup sent-state address and inbox links", () => {
  it("post-submit state shows the exact address the link went to", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({
      mode: "signup",
      linkSent: true,
      initialEmail: "founder@startup.io",
    });

    expect(markup).toContain("Link sent to");
    expect(markup).toContain("<strong>founder@startup.io</strong>");
  });

  it("offers an Open Gmail link for gmail.com addresses", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({ mode: "signup", linkSent: true, initialEmail: "new@gmail.com" });

    expect(markup).toContain('href="https://mail.google.com/"');
    expect(markup).toContain('rel="noopener"');
    expect(markup).toContain("Open Gmail");
    expect(markup).not.toContain("Open Outlook");
  });

  it("offers an Open Gmail link for googlemail.com addresses", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({
      mode: "signup",
      linkSent: true,
      initialEmail: "new@googlemail.com",
    });

    expect(markup).toContain('href="https://mail.google.com/"');
    expect(markup).toContain("Open Gmail");
  });

  it("offers an Open Outlook link for outlook.com, hotmail.com and live.com addresses", async () => {
    for (const domain of ["outlook.com", "hotmail.com", "live.com"]) {
      await mockReactRouter();
      const markup = await renderAuthForm({
        mode: "signup",
        linkSent: true,
        initialEmail: `new@${domain}`,
      });

      expect(markup).toContain('href="https://outlook.live.com/mail/"');
      expect(markup).toContain('rel="noopener"');
      expect(markup).toContain("Open Outlook");
      expect(markup).not.toContain("Open Gmail");
      vi.doUnmock("react-router");
      vi.resetModules();
    }
  });

  it("shows a plain Open your inbox line with no link for other domains", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({
      mode: "signup",
      linkSent: true,
      initialEmail: "founder@startup.io",
    });

    expect(markup).toContain("Open your inbox");
    expect(markup).not.toContain("mail.google.com");
    expect(markup).not.toContain("outlook.live.com");
    expect(markup).not.toContain('rel="noopener"');
  });

  it("keeps inbox links out of the login sent state", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({ mode: "login", linkSent: true, initialEmail: "user@gmail.com" });

    expect(markup).not.toContain("Open Gmail");
    expect(markup).not.toContain("Open Outlook");
    expect(markup).not.toContain("Open your inbox");
  });
});

describe("AuthForm signup resend", () => {
  it("resend form re-posts the same email, name and redirectTo", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({
      mode: "signup",
      linkSent: true,
      initialEmail: "new@example.com",
      initialName: "Nish Kumar",
      redirectTo: "/app?website=nykaa.com#setup-checklist",
    });

    expect(markup).toContain("Resend link");
    expect(markup).toContain('type="hidden" name="resend" value="1"');
    expect(markup).toContain('type="hidden" name="email" value="new@example.com"');
    expect(markup).toContain('type="hidden" name="name" value="Nish Kumar"');
    expect(markup).toContain('type="hidden" name="redirectTo" value="/app?website=nykaa.com#setup-checklist"');
  });

  it("shows Sent again with the address after a successful resend", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({
      mode: "signup",
      linkSent: true,
      linkResent: true,
      initialEmail: "new@example.com",
    });

    expect(markup).toContain("Sent again");
    expect(markup).toContain("<strong>new@example.com</strong>");
    expect(markup).not.toContain("Link sent to");
  });
});

describe("/auth/signup loader sent state", () => {
  it("exposes the sent address, name and resent marker for the post-submit screen", async () => {
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/auth.server", () => ({ getOptionalSession: vi.fn().mockResolvedValue(null) }));
    vi.doMock("~/lib/better-auth.server", () => ({
      enabledBetterAuthOAuthProviders: vi.fn(() => []),
    }));
    vi.doMock("~/lib/signup-source", () => ({ allowlistedSignupSource: vi.fn(() => null) }));

    const { loader } = await import("~/routes/auth.signup");
    const result = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request(
        "https://0509.io/auth/signup?sent=1&resent=1&email=owner%40gmail.com&name=Nish%20Kumar&redirectTo=%2Fapp",
      ),
    } as never);

    expect(result).toMatchObject({
      linkSent: true,
      linkResent: true,
      prefillEmail: "owner@gmail.com",
      prefillName: "Nish Kumar",
    });
  });
});

describe("/auth/signup resend action", () => {
  it("resend success re-sends through the same action and marks the link resent", async () => {
    const sendBetterAuthMagicLink = vi.fn().mockResolvedValue(undefined);
    mockSignupActionModules(sendBetterAuthMagicLink);

    const { action } = await import("~/routes/auth.signup");
    const request = new Request("https://0509.io/auth/signup?sent=1", {
      method: "POST",
      body: new URLSearchParams({
        resend: "1",
        name: "Nish Kumar",
        email: "Owner@Example.com",
        redirectTo: "/app#setup-checklist",
      }),
    });

    let response: Response | null = null;
    try {
      await action(actionArgs(request));
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    // The resend goes through the exact same send path (same rate-limit scope).
    expect(sendBetterAuthMagicLink).toHaveBeenCalledTimes(1);
    expect(sendBetterAuthMagicLink.mock.calls[0]?.[2]).toMatchObject({
      email: "owner@example.com",
      mode: "signup",
      name: "Nish Kumar",
      redirectTo: "/app#setup-checklist",
    });
    const location = new URL(response?.headers.get("Location") ?? "", "https://0509.io");
    expect(location.pathname).toBe("/auth/signup");
    expect(location.searchParams.get("sent")).toBe("1");
    expect(location.searchParams.get("resent")).toBe("1");
    expect(location.searchParams.get("email")).toBe("owner@example.com");
    expect(location.searchParams.get("name")).toBe("Nish Kumar");
    expect(location.searchParams.get("redirectTo")).toBe("/app#setup-checklist");
  });

  it("first send redirects to the sent state without the resent marker", async () => {
    const sendBetterAuthMagicLink = vi.fn().mockResolvedValue(undefined);
    mockSignupActionModules(sendBetterAuthMagicLink);

    const { action } = await import("~/routes/auth.signup");
    const request = new Request("https://0509.io/auth/signup", {
      method: "POST",
      body: new URLSearchParams({
        name: "Nish Kumar",
        email: "owner@example.com",
        redirectTo: "/app#setup-checklist",
      }),
    });

    let response: Response | null = null;
    try {
      await action(actionArgs(request));
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    const location = new URL(response?.headers.get("Location") ?? "", "https://0509.io");
    expect(location.searchParams.get("sent")).toBe("1");
    expect(location.searchParams.get("resent")).toBeNull();
    expect(location.searchParams.get("email")).toBe("owner@example.com");
    expect(location.searchParams.get("name")).toBe("Nish Kumar");
  });

  it("rate-limit refusal returns an error instead of the sent state and never logs the address", async () => {
    const rateLimitError = Object.assign(new Error("Too many requests"), { status: 429 });
    const sendBetterAuthMagicLink = vi.fn().mockRejectedValue(rateLimitError);
    mockSignupActionModules(sendBetterAuthMagicLink);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { action } = await import("~/routes/auth.signup");
    const request = new Request("https://0509.io/auth/signup?sent=1", {
      method: "POST",
      body: new URLSearchParams({
        resend: "1",
        name: "Nish Kumar",
        email: "owner@example.com",
        redirectTo: "/app#setup-checklist",
      }),
    });

    await expect(action(actionArgs(request))).resolves.toEqual({
      ok: false,
      error: "We couldn't send the setup link. Try again in a minute.",
      email: "owner@example.com",
      name: "Nish Kumar",
      redirectTo: "/app#setup-checklist",
      competitor: "",
    });
    // The refusal came out of the existing send path — not a bypass around it.
    expect(sendBetterAuthMagicLink).toHaveBeenCalledTimes(1);
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("owner@example.com");
    }
  });

  it("signup form shows the optional first-competitor field; login does not", async () => {
    await mockReactRouter();
    const signup = await renderAuthForm({ mode: "signup" });
    expect(signup).toContain("<span>First competitor website</span>");
    expect(signup).toContain('name="competitor"');

    const login = await renderAuthForm({ mode: "login" });
    expect(login).not.toContain("First competitor website");
    expect(login).not.toContain('name="competitor"');
  });

  it("signup form pre-fills the competitor field, literal round-trip, and it survives the resend form", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({ mode: "signup", initialCompetitor: "nykaa.com" });
    expect(markup).toContain('value="nykaa.com"');

    const sent = await renderAuthForm({
      mode: "signup",
      linkSent: true,
      initialEmail: "new@example.com",
      initialCompetitor: "nykaa.com",
    });
    // The sent state's resend form re-posts the competitor so the value
    // survives a resend exactly like the hidden name input does.
    expect(sent).toContain('name="competitor" value="nykaa.com"');
  });

  it("no competitor pre-fill renders no hidden resend competitor input", async () => {
    await mockReactRouter();
    const markup = await renderAuthForm({ mode: "signup" });
    expect(markup).toContain('name="competitor"');
    expect(markup).not.toContain('name="competitor" type="hidden"');
  });
});
