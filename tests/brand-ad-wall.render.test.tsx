// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 19's act() only works in an explicit act environment; happy-dom does
// not set this itself. Required for the mounted-render assertions below.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// BrandAdWall renders react-router <Link> (the "+N more" cell); the wall is
// exercised outside a Router here, so swap Link for a plain <a>.
vi.mock("react-router", async () => {
  const React = await import("react");
  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
  };
});

import type { AdRecord } from "~/lib/types";
import { BrandAdWall } from "~/components/ads/brand-ad-wall";

const NOW = new Date("2026-09-10T00:00:00Z");

type WallAdFixture = Partial<AdRecord> & Pick<AdRecord, "metaAdId">;

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: overrides.metaAdId ?? "ad-1",
    advertiser: "Nike",
    previewHeadline: "Run through summer.",
    hook: "Shop Now",
    cta: "Shop Now",
    format: "image",
    landingPageUrl: "https://www.nike.com/summer",
    firstSeenAt: "2026-01-01T00:00:00Z",
    lastSeenAt: null,
    activeStatusObserved: null,
    variantCount: null,
    creativeImageUrl: "https://example.com/creative.jpg",
    linkVerifiedDomain: null,
    ...overrides,
  } as AdRecord;
}

let container: HTMLElement | null = null;
let root: Root | null = null;

function renderWall(ads: WallAdFixture[]): string {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let html = "";
  act(() => {
    root!.render(
      createElement(BrandAdWall, {
        ads: ads as BrandAdWallProps["ads"],
        totalCount: ads.length,
        domain: "nike.com",
        fresh: true,
        signupPath: "/signup",
        now: NOW,
      }),
    );
  });
  html = container.innerHTML;
  return html;
}

type BrandAdWallProps = Parameters<typeof BrandAdWall>[0];

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("BrandAdWall saved-shot chip (issue #2475, M50)", () => {
  it("omits the 'Screenshot saved' chip on a card with no captured image", () => {
    const html = renderWall([ad({ metaAdId: "m50", creativeImageUrl: null })]);
    expect(html).not.toContain("Screenshot saved");
  });

  it("keeps the 'Screenshot saved' chip when a captured image exists", () => {
    const html = renderWall([ad({ metaAdId: "m50-keep" })]);
    expect(html).toContain("Screenshot saved");
  });

  it("drops the chip once the image onError flips the tile to the mock", () => {
    const html = renderWall([ad({ metaAdId: "m50-err" })]);
    expect(html).toContain("Screenshot saved");
    const img = container!.querySelector("img.f9-ads-thumb-img");
    expect(img).not.toBeNull();
    act(() => {
      img!.dispatchEvent(new Event("error", { bubbles: true }));
    });
    expect(container!.innerHTML).not.toContain("Screenshot saved");
  });

  it("keeps a non-screenshot label (e.g. 'New') on a card rendered as the mock", () => {
    const html = renderWall([
      ad({ metaAdId: "m50-mock-new", creativeImageUrl: null, firstSeenAt: "2026-09-09T12:00:00Z" }),
    ]);
    expect(html).toContain(">New<");
  });
});

describe("isNewlySeen future-date guard (issue #2475, M52)", () => {
  it("renders no 'New' badge and no 'Since' pill for a future firstSeenAt", () => {
    const html = renderWall([
      ad({ metaAdId: "m52", firstSeenAt: "2026-09-10T01:00:00Z" }),
    ]);
    expect(html).not.toContain(">New<");
    expect(html).not.toMatch(/Since/);
  });

  it("still shows the 'New' badge for a genuinely recent ad", () => {
    const html = renderWall([
      ad({ metaAdId: "m52-new", firstSeenAt: "2026-09-09T12:00:00Z" }),
    ]);
    expect(html).toContain(">New<");
  });
});
