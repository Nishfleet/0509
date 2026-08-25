import { describe, expect, it } from "vitest";

import { noindexMetaEntry } from "~/lib/seo";

// Auth/action surfaces must never be Google-indexable. Every auth route that
// renders a non-redirect response carries `<meta name="robots" content="noindex">`
// via the shared `noindexMetaEntry()` helper in app/lib/seo.ts. The redirect-
// only auth routes (reset-password, oauth) carry noindex through their final
// destination (/auth/login), so this test verifies they redirect instead of
// rendering an indexable page.
//
// /auth/signup is the parallel scope of #924 (it has its own noindex + sitemap
// removal PR) and is intentionally not asserted here so the two PRs stay
// independently green. The shared helper is the coordination point: #924
// reuses `noindexMetaEntry()` rather than re-inlining the tag.

type MetaEntry = { name?: string; content?: string; title?: string; [key: string]: unknown };

function hasNoindexEntry(entries: readonly MetaEntry[]): boolean {
  return entries.some(
    (entry) => entry.name === "robots" && entry.content === "noindex",
  );
}

describe("auth surfaces carry robots noindex", () => {
  it("exposes a shared noindexMetaEntry() helper in app/lib/seo.ts", () => {
    expect(noindexMetaEntry()).toEqual({ name: "robots", content: "noindex" });
  });

  it("/auth/login meta appends the noindex entry alongside publicSeoMeta", async () => {
    const { meta } = await import("~/routes/auth.login");
    const entries = (meta as unknown as () => MetaEntry[])();
    expect(hasNoindexEntry(entries)).toBe(true);
    // The canonical/SEO entries are preserved — noindex is additive, not a
    // replacement of the publicSeoMeta head.
    expect(entries.some((entry) => entry.name === "description")).toBe(true);
    expect(entries.some((entry) => entry.property === "og:url")).toBe(true);
  });

  it("/auth/better/magic-link meta appends the noindex entry (it renders, not a pure redirect)", async () => {
    const { meta } = await import("~/routes/auth.better.magic-link");
    const entries = (meta as unknown as () => MetaEntry[])();
    expect(hasNoindexEntry(entries)).toBe(true);
  });

  it("/auth/reset-password is redirect-only and lands on /auth/login (noindex via destination)", async () => {
    const { loader } = await import("~/routes/auth.reset-password");
    try {
      await loader({ request: new Request("https://0509.io/auth/reset-password") } as never);
      throw new Error("Expected reset-password loader to redirect");
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(302);
      const location = response.headers.get("Location") ?? "";
      // Lands on /auth/login (with an error query), which carries noindex.
      expect(location.startsWith("/auth/login")).toBe(true);
    }
  });

  it("/auth/better/oauth is redirect-only and lands on /auth/login or /auth/signup", async () => {
    const { loader } = await import("~/routes/auth.better.oauth");
    try {
      await loader({ request: new Request("https://0509.io/auth/better/oauth") } as never);
        throw new Error("Expected oauth loader to redirect");
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(302);
      const location = response.headers.get("Location") ?? "";
      // Default mode is login; signup mode redirects to /auth/signup. Both are
      // auth surfaces that carry (or will carry, via #924) noindex.
      expect(location === "/auth/login" || location === "/auth/signup").toBe(true);
    }
  });
});
