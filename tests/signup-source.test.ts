import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAGICBRIEF_MIGRATION_SOURCE, PRICING_FREE_SIGNUP_SOURCE } from "~/lib/funnel-measurement.server";
import {
  ALLOWED_SIGNUP_SOURCES,
  allowlistedSignupSource,
  LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES,
  readSignupSourceCookie,
  SIGNUP_SOURCE_COOKIE,
  signupSourceCookieHeader,
} from "~/lib/signup-source";

describe("allowlisted signup_source", () => {
  it("keeps the MagicBrief, pricing-free, and locale sneaker-resale markers, and nothing else", () => {
    expect(ALLOWED_SIGNUP_SOURCES).toContain(MAGICBRIEF_MIGRATION_SOURCE);
    expect(allowlistedSignupSource(MAGICBRIEF_MIGRATION_SOURCE)).toBe(MAGICBRIEF_MIGRATION_SOURCE);
    expect(ALLOWED_SIGNUP_SOURCES).toContain(PRICING_FREE_SIGNUP_SOURCE);
    expect(allowlistedSignupSource(PRICING_FREE_SIGNUP_SOURCE)).toBe(PRICING_FREE_SIGNUP_SOURCE);
    expect(allowlistedSignupSource("locale-de-sneaker-resale")).toBe("locale-de-sneaker-resale");
    expect([...LOCALE_SNEAKER_RESALE_SIGNUP_SOURCES]).toEqual([
      "locale-en-sneaker-resale",
      "locale-de-sneaker-resale",
      "locale-ja-sneaker-resale",
      "locale-pt-br-sneaker-resale",
    ]);
  });

  it("drops the raw query string, unknown markers, and hostile values", () => {
    expect(allowlistedSignupSource("magicbrief-migration&x=<script>")).toBeNull();
    expect(allowlistedSignupSource("<script>alert(1)</script>")).toBeNull();
    expect(allowlistedSignupSource("/auth/signup?source=magicbrief-migration")).toBeNull();
    expect(allowlistedSignupSource("not-a-marker")).toBeNull();
    expect(allowlistedSignupSource("pricing-free&x=1")).toBeNull();
    expect(allowlistedSignupSource(" PRICING-FREE ")).toBeNull();
    expect(allowlistedSignupSource("")).toBeNull();
    expect(allowlistedSignupSource(null)).toBeNull();
    expect(allowlistedSignupSource(" MAGICBRIEF-MIGRATION ")).toBeNull();
  });

  it("sets and reads only an allowlisted cookie value", () => {
    const header = signupSourceCookieHeader(
      new Request("https://0509.io/auth/signup"),
      "locale-ja-sneaker-resale",
    );
    expect(header).toContain(`${SIGNUP_SOURCE_COOKIE}=locale-ja-sneaker-resale`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Domain=0509.io");
    expect(header).not.toContain("script");

    const request = new Request("https://0509.io/api/auth/magic-link/verify", {
      headers: { cookie: `${SIGNUP_SOURCE_COOKIE}=locale-ja-sneaker-resale` },
    });
    expect(readSignupSourceCookie(request)).toBe("locale-ja-sneaker-resale");
    expect(
      readSignupSourceCookie(
        new Request("https://0509.io/", {
          headers: { cookie: `${SIGNUP_SOURCE_COOKIE}=<script>` },
        }),
      ),
    ).toBeNull();
  });
});

describe("signup action dual-write", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sets the allowlisted cookie after a MagicBrief signup start and never puts the raw query on the user path", async () => {
    const statements: string[] = [];
    const env = {
      FUNNEL_MEASUREMENT_ENABLED: "1",
      DB: {
        prepare(sql: string) {
          statements.push(sql);
          return {
            bind() {
              return {
                async run() {
                  return { success: true, meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    };
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({
      isBetterAuthConfigured: vi.fn().mockReturnValue(true),
      isSameOriginAuthFormPost: vi.fn().mockReturnValue(true),
      sendBetterAuthMagicLink: vi.fn().mockResolvedValue(undefined),
    }));

    const { action } = await import("~/routes/auth.signup");
    const request = new Request(
      "http://localhost/auth/signup?source=magicbrief-migration&x=%3Cscript%3E",
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "owner@example.com",
          name: "Owner",
          redirectTo: "/app#setup-checklist",
        }),
      },
    );

    let thrown: unknown;
    try {
      await action({ context: { cloudflare: { env } }, request } as never);
    } catch (error) {
      thrown = error;
    }

    const response = thrown as Response;
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("source=magicbrief-migration");
    expect(location).not.toContain("script");
    expect(response.headers.get("Set-Cookie") ?? "").toContain(
      `${SIGNUP_SOURCE_COOKIE}=magicbrief-migration`,
    );
    expect(statements.some((sql) => sql.includes("signup_source_pending"))).toBe(true);
    expect(JSON.stringify(statements)).not.toContain("script");
  });
});

describe("AuthForm hidden signupSource", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("react-router");
  });

  it("posts the allowlisted marker and never the raw query string", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      };
    });

    const { AuthForm } = await import("~/components/auth-form");
    const markup = renderToStaticMarkup(
      createElement(AuthForm, {
        mode: "signup",
        redirectTo: "/app#setup-checklist",
        signupSource: "locale-de-sneaker-resale",
      }),
    );

    expect(markup).toContain('name="signupSource"');
    expect(markup).toContain('value="locale-de-sneaker-resale"');
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("utm_");
  });
});
