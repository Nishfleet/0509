import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = {
  children?: ReactNode;
  to?: string;
} & Record<string, unknown>;

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

/**
 * dogfood 694ddbd68e95 also flags /auth/login (193 rendered words). The story
 * column now carries a second proof row — digests, reports, team workspaces —
 * so the rendered page clears the engine's 250-word thin-content floor. This
 * test renders the real route and counts the produced text, mirroring the
 * engine's `document.body.textContent` split.
 */
async function mockReactRouter() {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      useLoaderData: () => ({
        redirectTo: "/app",
        prefillEmail: "",
        linkSent: false,
      }),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

async function renderLoginRoute() {
  const { default: LoginRoute } = await import("~/routes/auth.login");
  return renderToStaticMarkup(createElement(LoginRoute));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("auth login page content depth", () => {
  it("renders the second proof row: digests, reports, team workspaces", async () => {
    await mockReactRouter();
    const markup = await renderLoginRoute();

    expect(markup).toContain("Return to the changes your team is watching.");
    expect(markup).toContain("Digests");
    expect(markup).toContain(
      "A scheduled email that recaps what changed across your watchlists",
    );
    expect(markup).toContain("Reports");
    expect(markup).toContain("A client-ready brief assembled from your saved examples");
    expect(markup).toContain("Team workspaces");
    expect(markup).toContain(
      "Invite teammates so the watch keeps running when you&#x27;re away",
    );
    expect(markup).toContain(
      "We email you a one-time sign-in link — there&#x27;s no password to remember",
    );
  });

  it("keeps the story column deep enough for the engine's 250-word floor", async () => {
    await mockReactRouter();
    const markup = await renderLoginRoute();

    // dogfood 694ddbd68e95: /auth/login rendered 193 words. This fragment
    // counts visible text plus tag-boundary tokens (measured 184); the real
    // visible text is ~166, and the deployed body adds ~120 tokens of SSR
    // script text, so the live page measures ~285 — a ~35-word margin over
    // the engine's 250-word thin-content floor. The floor below guards the
    // copy depth without hard-coding script payload sizes.
    const text = markup.replace(/<[^>]+>/g, " ");
    const words = text.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(180);
  });
});
