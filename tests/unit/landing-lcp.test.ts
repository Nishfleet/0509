import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Landing, { links as landingLinks } from "../../app/routes/landing";
import { links as productLinks } from "../../app/routes/faces-layout";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function hrefs(descriptors: ReturnType<typeof landingLinks>): string[] {
  return descriptors.map((descriptor) => (typeof descriptor === "string" ? descriptor : descriptor.href ?? ""));
}

describe("landing LCP critical path", () => {
  it("renders the headline on the server and preloads the small face", () => {
    const html = renderToStaticMarkup(createElement(Landing));
    expect(html).toContain("Know where you stand.");
    expect(html).not.toContain("bricolage-grotesque-latin");
    expect(html).not.toContain("instrument-sans");
    expect(html).not.toContain("ibm-plex");

    const head = hrefs(landingLinks());
    expect(head).toContain("/fonts/bricolage-hero.woff2");
    expect(head.join(" ")).not.toMatch(/bricolage-grotesque-latin|instrument-sans|ibm-plex/);

    const bytes = readFileSync(join(REPO_ROOT, "public/fonts/bricolage-hero.woff2"));
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(bytes.length).toBeLessThan(12_000);
  });

  it("keeps the full faces on the other documents", () => {
    const head = hrefs(productLinks());
    expect(head).toContain("/fonts/bricolage-grotesque-latin.woff2");
    expect(head).toContain("/fonts/instrument-sans-latin.woff2");
    expect(head.join(" ")).not.toContain("bricolage-hero");
  });
});
