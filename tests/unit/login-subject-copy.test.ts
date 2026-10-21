import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

const TURNSTILE_SITE_KEY = vi.hoisted(() => "1x00000000000000000000BB");

vi.mock("cloudflare:workers", () => ({ env: { TURNSTILE_SITE_KEY } }));
vi.mock("../../app/lib/auth.server", () => ({
  createAuth: () => ({}),
  createAuthForRequest: async () => ({}),
}));

import Login from "../../app/routes/login";

function render(search: string): string {
  const Stub = createRoutesStub([{ id: "routes/login", path: "/login", Component: Login }]);
  return renderToStaticMarkup(
    createElement(Stub, {
      initialEntries: [`/login${search}`],
      hydrationData: {
        loaderData: {
          "routes/login": { id: null, progress: null, turnstileSiteKey: TURNSTILE_SITE_KEY, linkError: null },
        },
      },
    }),
  );
}

function heading(html: string): string {
  return /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
}

const SUBJECT_LEDE = "Enter your email. We&#x27;ll send a link that creates your account. No password.";

describe("Login copy with and without a subject", () => {
  it("keeps the plain sign-in copy when no site was typed", () => {
    const html = render("");
    expect(heading(html)).toBe("Sign in");
    expect(html).toContain("New or returning, we email you a link.");
    expect(html).not.toContain("Start watching");
    expect(html).not.toContain(SUBJECT_LEDE);
  });

  it("keeps the plain copy for a blank subject", () => {
    expect(heading(render("?subject=%20%20"))).toBe("Sign in");
  });

  it("names the site and says the link creates an account", () => {
    const html = render("?subject=qaverify-shop.com");
    expect(heading(html)).toBe("Start watching qaverify-shop.com");
    expect(html).toContain(SUBJECT_LEDE);
    expect(html).not.toContain("New or returning");
  });

  it("shows the bare host for a pasted address", () => {
    expect(heading(render("?subject=https%3A%2F%2Fwww.gymshark.com%2Fcollections%3Fa%3D1"))).toBe(
      "Start watching gymshark.com",
    );
  });

  it("falls back to plain sign-in for a subject that is not a site or brand name", () => {
    expect(heading(render("?subject=%3Cscript%3Ealert(1)%3C%2Fscript%3E"))).toBe("Sign in");
    expect(heading(render(`?subject=${"a".repeat(200)}`))).toBe("Sign in");
  });

  it("adds no price, trial, card or legal lines", () => {
    const main = /<main\b[\s\S]*<\/main>/.exec(render("?subject=gymshark.com"))?.[0] ?? "";
    const text = main.replace(/<[^>]+>/g, " ");
    expect(text).toContain("Start watching gymshark.com");
    expect(text).not.toMatch(/trial|price|\$|card|Terms|Privacy/i);
  });
});
