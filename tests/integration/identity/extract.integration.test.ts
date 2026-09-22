import { describe, expect, it } from "vitest";

import { extract } from "../../../app/lib/identity/extract";
import { logoCandidates, resolveLogo } from "../../../app/lib/identity/logo-cascade";
import fixture from "../../fixtures/gymshark-2026-09-21.html?raw";

// Runs in the workers project (workerd) — HTMLRewriter is a platform
// primitive and does not exist under the node environment. The fixture is a
// ?raw import because the isolate's node:fs cannot read repo files.
const PAGE = "https://www.gymshark.com/";

describe("extract — gymshark fixture fetched 2026-09-22 11:28Z", () => {
  it("recovers the fields the design cites", async () => {
    const x = await extract(fixture, PAGE);
    expect(x.name).toBe("Gymshark");
    expect(x.ldOrganization?.name).toBe("Gymshark");
    expect(String(x.ldOrganization?.logo)).toContain("images.ctfassets.net");
    const socials = x.socials.join(" ");
    for (const s of ["facebook.com/Gymshark", "twitter.com/Gymshark", "instagram.com/gymshark", "youtube.com", "linkedin.com/company/gymshark"]) {
      expect(socials).toContain(s);
    }
    expect(x.manifestHref).toBe("https://www.gymshark.com/site.webmanifest");
    expect(x.iconLinks.length).toBeGreaterThan(0);
    expect(x.text.length).toBeGreaterThan(200);
    expect(x.navLinks.length).toBeGreaterThan(0);
  });
});

describe("logoCandidates + resolveLogo", () => {
  it("orders manifest -> apple-touch -> icon -> google -> ddg -> favicon -> og", async () => {
    const x = await extract(fixture, PAGE);
    const order = logoCandidates(PAGE, x, ["https://www.gymshark.com/images/android-chrome-192x192.png"]).map((c) => c.via);
    const idx = (v: string) => order.indexOf(v);
    expect(idx("manifest")).toBe(0);
    expect(idx("apple-touch-icon")).toBeGreaterThan(idx("manifest"));
    expect(idx("google-faviconV2")).toBeGreaterThan(idx("apple-touch-icon"));
    expect(idx("duckduckgo-ip3")).toBeGreaterThan(idx("google-faviconV2"));
    expect(idx("favicon-ico")).toBeGreaterThan(idx("duckduckgo-ip3"));
    expect(idx("ld-or-og")).toBe(order.length - 1);
  });

  it("GETs candidates, checks res.ok, skips non-images — only one survives", async () => {
    const calls: string[] = [];
    const stub: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.includes("duckduckgo")) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/x-icon" } });
      }
      return new Response("not found", { status: 404 });
    };
    const { hit, misses } = await resolveLogo(
      [
        { url: "https://a.test/one.png", via: "manifest" },
        { url: "https://icons.duckduckgo.com/ip3/x.ico", via: "duckduckgo-ip3" },
        { url: "https://a.test/og.png", via: "ld-or-og" },
      ],
      stub,
    );
    expect(hit?.via).toBe("duckduckgo-ip3");
    expect(calls.length).toBe(2); // stops at first success; og:image never tried
    expect(misses).toEqual([{ via: "manifest", reason: "http 404" }]);
  });
});
