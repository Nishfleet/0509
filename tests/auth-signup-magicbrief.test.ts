import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dedicated route-render surface for the MagicBrief wind-down capture message
// on /auth/signup. Markup-only: the loader is mocked with the source flag the
// migration page CTA carries, and nothing here exercises Better Auth.

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function signupLoaderData(source: string | null) {
  return {
    redirectTo: "/app#setup-checklist",
    prefillEmail: "",
    linkSent: false,
    ...(source ? { message: magicbriefMigrationMessage(source) } : {}),
  };
}

function magicbriefMigrationMessage(source: string): string | null {
  if (source !== "magicbrief-migration") {
    return null;
  }
  return (
    "Coming from MagicBrief? Sign up, then use the setup checklist's competitor import " +
    "to turn your list into watchlists. Collections, boards, analytics history, and past " +
    "evidence are not migrated — you recreate them with our help."
  );
}

async function renderSignup(source: string | null) {
  const loaderData = signupLoaderData(source);
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useActionData: vi.fn().mockReturnValue(null),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });

  const { default: SignupRoute } = await import("~/routes/auth.signup");
  return renderToStaticMarkup(createElement(SignupRoute));
}

describe("/auth/signup MagicBrief migration capture message", () => {
  it("shows the migration path message to a visitor arriving from the migration CTA", async () => {
    const markup = await renderSignup("magicbrief-migration");

    expect(markup).toContain("Coming from MagicBrief?");
    expect(markup).toContain("setup checklist");
    expect(markup).toContain("competitor import");
    expect(markup).toContain("turn your list into watchlists");
    expect(markup).toContain(
      "Collections, boards, analytics history, and past evidence are not migrated",
    );
    expect(markup).toContain("you recreate them with our help");
  });

  it("keeps the honest boundary: the migration message never promises full transfer", async () => {
    const markup = await renderSignup("magicbrief-migration");

    expect(markup).not.toContain("we migrate everything");
    expect(markup).not.toContain("move your collections and watchlists");
  });

  it("stays silent for visitors arriving without the migration source", async () => {
    const markup = await renderSignup(null);

    expect(markup).not.toContain("Coming from MagicBrief?");
  });

  it("does not show the migration message once the setup link has been sent", async () => {
    vi.resetModules();
    const loaderData = {
      redirectTo: "/app#setup-checklist",
      prefillEmail: "",
      linkSent: true,
      message: "Check your email. The setup link will verify you and create the account.",
    };
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useLoaderData: vi.fn().mockReturnValue(loaderData),
        useActionData: vi.fn().mockReturnValue(null),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      };
    });

    const { default: SignupRoute } = await import("~/routes/auth.signup");
    const markup = renderToStaticMarkup(createElement(SignupRoute));

    expect(markup).toContain("Check your email.");
    expect(markup).not.toContain("Coming from MagicBrief?");
  });
});
