import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appEnv } from "./fixtures";
import { createLandingPageSnapshot } from "~/lib/data/ads.server";

/**
 * Issue #3105 (BET 3): landing-page proofs are archived in BOTH viewports.
 *
 * Panoramata and Foreplay Spyder both archive landing pages desktop AND
 * mobile; 0509 only ever produced the 390x844 mobile capture, so the
 * "See what changed, with proof" promise showed a competitor's page only as
 * a phone screenshot. This suite drives `captureBrowserRunSnapshot` (the
 * exact capture path the monitoring pipeline calls) against real local
 * workerd D1 with the repo's real migrations and an in-memory R2 bucket, and
 * asserts the issue's accept criteria:
 *
 *   (1) one capture produces BOTH viewports' artifacts, each labelled with
 *       its renderMode in the R2 object's customMetadata;
 *   (2) both keys are attached to the snapshot metadata (desktop is archived
 *       evidence; the mobile snapshot stays the single extraction / alert
 *       source — `renderMode` stays "mobile", `desktopRenderMode` is "desktop")
 *       and the mobile + desktop artifact set persists through
 *       `createLandingPageSnapshot` without any migration;
 *   (3) a failed desktop leg is recorded honestly as
 *       `desktopCaptureFailed: <reason>` with a `desktop_capture_failed`
 *       warning code — never as a phantom capture — and the mobile capture
 *       itself still succeeds.
 *
 * Mocked D1 cannot see the real schema (the telemetry writer and the
 * landing_page_snapshot writer both exercise real tables here); mocked
 * bindings cannot see the artifact labels — so R2 is a capturing
 * in-memory stub and D1 is the real thing.
 */

vi.mock("~/lib/public-url.server", () => ({
  resolvePublicHttpUrl: vi.fn(async (value: string | URL) => new URL(value.toString())),
  resolvePublicRedirectUrl: vi.fn((location: string | null) => location ?? null),
  normalizePublicHttpUrl: vi.fn((value: string | URL) => new URL(value.toString())),
}));

const LANDING_HTML =
  `<html><head><meta property="og:title" content="Dual viewport proof"></head>` +
  `<body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`;

type LegPage = ReturnType<typeof createLegPage>;

function createLegPage() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(LANDING_HTML),
    goto: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9])),
    url: vi.fn().mockReturnValue("https://dual-viewport.example/offer"),
  };
}

/** In-memory R2 stub: records every put with its options for inspection. */
function createArtifactBucket() {
  const puts: RecordedPut[] = [];
  return {
    puts,
    put: vi.fn(async (key: string, value: unknown, options: Record<string, unknown>) => {
      puts.push({ key, value, options });
      return undefined;
    }),
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@cloudflare/puppeteer");
});

async function capture(options: { secondPage?: ReturnType<typeof createLegPage> } = {}) {
  const mobilePage = createLegPage();
  const desktopPage = options.secondPage ?? createLegPage();
  const pages: ReturnType<typeof createLegPage>[] = [mobilePage, desktopPage];
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockImplementation(async () => pages.shift() ?? createLegPage()),
  };
  const launch = vi.fn().mockResolvedValue(browser);
  vi.doMock("@cloudflare/puppeteer", () => ({ default: { launch } }));
  const bucket = createArtifactBucket();

  const { captureBrowserRunSnapshot } = await import("~/lib/browser-run.server");
  const snapshot = await captureBrowserRunSnapshot(
    {
      BROWSER: {} as never,
      LANDING_PAGE_ARTIFACTS: bucket as never,
      DB: appEnv.DB,
    } as never,
    "https://dual-viewport.example/offer",
    {},
  );
  return { snapshot, bucket, mobilePage, desktopPage };
}

type RecordedPut = { key: string; value: unknown; options: Record<string, unknown> };

function jpegPuts(puts: RecordedPut[]) {
  return puts.filter((entry) => String(entry.key).endsWith(".jpeg"));
}

describe("landing-page dual-viewport capture against real D1 + R2", () => {
  it("(1) one capture stores mobile AND desktop screenshot artifacts, each labelled with its renderMode", async () => {
    const { snapshot, bucket, mobilePage, desktopPage } = await capture();

    expect(snapshot).not.toBeNull();
    const captures = jpegPuts(bucket.puts);
    expect(captures).toHaveLength(2);

    const modes = captures
      .map((entry) => (entry.options.customMetadata as Record<string, unknown>).renderMode)
      .sort();
    expect(modes).toEqual(["desktop", "mobile"]);

    const mobile = captures.find(
      (entry) => (entry.options.customMetadata as Record<string, unknown>).renderMode === "mobile",
    )!;
    const desktop = captures.find(
      (entry) => (entry.options.customMetadata as Record<string, unknown>).renderMode === "desktop",
    )!;
    expect((mobile.options.customMetadata as Record<string, unknown>).deviceProfile).toBe(
      "mobile_default",
    );
    expect((desktop.options.customMetadata as Record<string, unknown>).deviceProfile).toBe(
      "desktop_default",
    );

    // Each leg was rendered at its own viewport: mobile 390x844 iPhone UA,
    // desktop 1200x800-class + desktop UA.
    expect(mobilePage.setViewport).toHaveBeenCalledWith(
      expect.objectContaining({ width: 390, height: 844, isMobile: true }),
    );
    expect(desktopPage.setViewport).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1280, height: 800, isMobile: false }),
    );
    expect(desktopPage.setUserAgent).toHaveBeenCalledWith(expect.stringMatching(/Chrome/u));

    const metadata = snapshot?.metadata as Record<string, unknown>;
    expect(metadata.renderMode).toBe("mobile");
    expect(metadata.screenshotArtifactKey).toBe(mobile.key);
    expect(metadata.desktopRenderMode).toBe("desktop");
    expect(metadata.desktopScreenshotArtifactKey).toBe(desktop.key);
    expect(metadata.desktopCaptureFailed).toBeUndefined();
  });

  it("(2) the dual-viewport evidence set persists on one landing_page_snapshot row", async () => {
    const { snapshot } = await capture();
    expect(snapshot).not.toBeNull();

    const id = await createLandingPageSnapshot(appEnv, {
      rawUrl: "https://persist-dual.example/offer",
      canonicalUrl: "https://persist-dual.example/offer",
      rawHeadline: "Dual viewport persist",
      normalizedHeadline: "dual viewport persist",
      normalizedHeadlineHash: "hash_dual_persist",
      captureMethod: "browser_render",
      artifactKey: (snapshot?.metadata as Record<string, unknown>).htmlArtifactKey as string,
      metadata: snapshot?.metadata as Record<string, unknown>,
      ctaText: "Shop now",
      priceText: "$59",
      formPresent: true,
      capturedAt: new Date().toISOString(),
    });
    expect(id).not.toBeNull();

    const row = await appEnv.DB!
      .prepare("SELECT metadata_json FROM landing_page_snapshot WHERE id = ?")
      .bind(id)
      .first<{ metadata_json: string | null }>();
    expect(row).not.toBeNull();
    const metadata = JSON.parse(row?.metadata_json ?? "{}") as Record<string, unknown>;
    expect(metadata.renderMode).toBe("mobile");
    expect(metadata.desktopRenderMode).toBe("desktop");
    // Both viewports' screenshot artifacts survive persistence on the row:
    // `screenshotArtifactKey` (mobile) and `desktopScreenshotArtifactKey`
    // (desktop) — columns already exist, no migration required.
    expect(typeof metadata.screenshotArtifactKey).toBe("string");
    expect(typeof metadata.desktopScreenshotArtifactKey).toBe("string");
    expect(metadata.desktopScreenshotArtifactKey).not.toBe(metadata.screenshotArtifactKey);
  });

  it("(3) a failed desktop leg records its true skip reason and still captures mobile", async () => {
    const failingDesktopPage = createLegPage();
    failingDesktopPage.goto = vi.fn().mockRejectedValue(new Error("desktop navigation refused"));
    const { snapshot, bucket } = await capture({ secondPage: failingDesktopPage });

    expect(snapshot).not.toBeNull();
    // Mobile evidence landed; NO desktop artifacts exist, and none were invented.
    expect(jpegPuts(bucket.puts)).toHaveLength(1);
    const metadata = snapshot?.metadata as Record<string, unknown>;
    expect(metadata.desktopCaptureFailed).toBe("desktop_capture_failed");
    expect(metadata.desktopScreenshotArtifactKey).toBeUndefined();
    expect(metadata.desktopHtmlArtifactKey).toBeUndefined();
    expect(metadata.desktopRenderMode).toBeUndefined();
    // The single alert source is untouched: this is still exactly one
    // capture (one mobile snapshot), not a second alert source.
    expect(metadata.captureWarningCodes).toContain("desktop_capture_failed");
  });
});
