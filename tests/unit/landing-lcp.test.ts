import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Landing, { handle, links as landingLinks } from "../../app/routes/landing";
import { links as productLinks } from "../../app/routes/faces-layout";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HERO_FACE = "/fonts/bricolage-hero.woff2";
const FULL_FACE = "/fonts/bricolage-grotesque-latin.woff2";

function hrefOf(descriptor: { href?: string } | string): string {
  return typeof descriptor === "string" ? descriptor : (descriptor.href ?? "");
}

function preloads(descriptors: readonly ({ rel?: string; as?: string; href?: string } | string)[], as: string): string[] {
  return descriptors
    .filter((descriptor) => typeof descriptor !== "string" && descriptor.rel === "preload" && descriptor.as === as)
    .map(hrefOf);
}

describe("landing LCP critical path", () => {
  it("ships the headline in the first markup and preloads styles ahead of the small face", () => {
    const html = renderToStaticMarkup(createElement(Landing));
    expect(html).toContain("Know where you stand.");
    expect(html).not.toContain(FULL_FACE);

    const landing = landingLinks();
    expect(preloads(landing, "font")).toEqual([HERO_FACE]);
    expect(handle.scripts).toBe(false);
    expect(landing.map(hrefOf).join(" ")).not.toContain("bricolage-grotesque-latin");

    const shipped = readFileSync(join(REPO_ROOT, "public/fonts/bricolage-hero.woff2"));
    expect(shipped.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(shipped.length).toBeLessThan(12_000);
  });

  it("preloads the full display and body faces for every other document", () => {
    const head = productLinks().map(hrefOf);
    expect(head).toContain(FULL_FACE);
    expect(head).toContain("/fonts/instrument-sans-latin.woff2");
    expect(head.join(" ")).not.toContain("data:font");
    expect(head).not.toContain(HERO_FACE);
  });
});
