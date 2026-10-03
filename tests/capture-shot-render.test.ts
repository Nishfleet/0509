import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MissingShot, ShotImage } from "../app/components/capture-shot";

function shot(overrides: Partial<Parameters<typeof ShotImage>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ShotImage, {
      src: "/after.png?w=208",
      width: 208,
      height: 74,
      loading: "lazy",
      className: "shot",
      ...overrides,
    }),
  );
}

describe("ShotImage", () => {
  it("renders one img with the given src, size, class and async decode", () => {
    const html = shot();
    expect(html.match(/<img\b/g)).toHaveLength(1);
    expect(html).toContain('alt=""');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('src="/after.png?w=208"');
    expect(html).toContain('width="208"');
    expect(html).toContain('height="74"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('class="shot"');
  });

  it("renders eager loading when the caller asks for it", () => {
    expect(shot({ loading: "eager" })).toContain('loading="eager"');
  });

  it("renders fetchpriority only when the priority is set", () => {
    expect(shot({ fetchPriority: "high" }).toLowerCase()).toContain('fetchpriority="high"');
    expect(shot({ fetchPriority: "auto" }).toLowerCase()).toContain('fetchpriority="auto"');
    expect(shot().toLowerCase()).not.toContain("fetchpriority");
  });

  it("takes its src and size from the caller", () => {
    const html = shot({ src: "/b?k=1&w=76", width: 76, height: 56, className: "small" });
    expect(html).toContain('src="/b?k=1&amp;w=76"');
    expect(html).toContain('width="76"');
    expect(html).toContain('height="56"');
    expect(html).toContain('class="small"');
  });
});

describe("MissingShot", () => {
  it("renders the reason in a span that carries the capture-missing slot", () => {
    const html = renderToStaticMarkup(createElement(MissingShot, { text: "Capture failed: timeout" }));
    expect(html.match(/<span\b/g)).toHaveLength(1);
    expect(html).toContain('data-slot="capture-missing"');
    expect(html).toContain("Capture failed: timeout");
  });

  it("escapes the text it is given", () => {
    const html = renderToStaticMarkup(createElement(MissingShot, { text: '<script>&"amp"' }));
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;&quot;amp&quot;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('"amp"');
  });
});
