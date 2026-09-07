import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdThumb } from "~/components/ad-thumb";

describe("AdThumb", () => {
  it("names an unavailable creative preview without exposing an ambiguous format label", () => {
    const markup = renderToStaticMarkup(
      createElement(AdThumb, {
        ad: { advertiser: "Nykaa", creativeImageUrl: null, format: "image" },
      }),
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Image ad creative preview unavailable"');
    expect(markup).toContain('<span aria-hidden="true">Image</span>');
  });

  it("survives ad records whose format is missing at runtime", () => {
    // Regression: captured/search ad records can arrive with an undefined
    // `format` even though the type says string. formatCreativeKind used to call
    // `.trim()` unconditionally and threw, 500ing every results/collection page
    // that contained such an ad (e.g. the starter collections route).
    const markup = renderToStaticMarkup(
      createElement(AdThumb, {
        ad: {
          advertiser: "Nykaa",
          creativeImageUrl: null,
          format: undefined as never,
        },
      }),
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Ad ad creative preview unavailable"');
    expect(markup).toContain('<span aria-hidden="true">Ad</span>');
  });

  it("keeps a captured creative image informative", () => {
    const markup = renderToStaticMarkup(
      createElement(AdThumb, {
        ad: {
          advertiser: "Nykaa",
          creativeImageUrl: "https://cdn.example.test/creative.jpg",
          format: "image",
        },
      }),
    );

    expect(markup).toContain('alt="Ad creative from Nykaa"');
    expect(markup).toContain('src="https://cdn.example.test/creative.jpg"');
    expect(markup).not.toContain("preview unavailable");
  });
});
