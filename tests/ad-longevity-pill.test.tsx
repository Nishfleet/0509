import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdLongevityPill } from "~/components/ad-longevity-pill";

describe("AdLongevityPill", () => {
  it("does not claim an ad is running when active status was not observed", () => {
    const markup = renderToStaticMarkup(
      <AdLongevityPill
        ad={{
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastSeenAt: null,
          activeStatusObserved: false,
        }}
      />,
    );

    expect(markup).toBe("");
  });
});
