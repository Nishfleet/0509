// @vitest-environment happy-dom

// Issue #3306 — BET 2 finish line: the /search Likely-match row says
// "Confirm — yes, that's them" but the trail control did not confirm
// anything: signed-out it only opened the detail pane (no signup intent, no
// carried context), and the instructional note next to it shipped without any
// working control. This suite pins the real contract at the rendered-HTML
// surface:
//
// (a) signed-out: every Likely-match row renders the confirm control as a
//     keyboard-reachable link whose destination IS the signup intent — the
//     Track-wall `redirectTo` shape (/app?website=…#setup-checklist) carrying
//     the searched domain, plus the allowlisted `source=search-likely-confirm`
//     marker; the instructional note renders WITH its own working control.
// (b) signed-in: the same control keeps the plain record href (the
//     `?selected=` reload) whose selection persistence records the
//     confirmation — the record itself is proven against real D1 by
//     tests/integration/search-likely-confirm.integration.test.ts.
//
// The production mechanism is exercised, not re-derived: the real route
// component renders from real loader-data shape, exactly the way the
// streaming-three-tier suite (issue 1482) does.

import { act, createElement, type Root, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SEARCH =
  "?website=https%3A%2F%2Fnotion.so&mode=advertiser&query=notion.so&country=all&trackingRole=competitor";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = {
  children?: ReactNode;
  to?: string;
} & Record<string, unknown>;

let loaderData: Record<string, unknown>;
let routeLoaderData: Record<string, unknown>;
let locationObj: { pathname: string; search: string; hash: string };
let navigationState: { state: string; location?: unknown };
let revalidatorRef: { state: string; revalidate: ReturnType<typeof vi.fn> };
let navigateMock: ReturnType<typeof vi.fn>;

function mockRouter() {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          {
            ...props,
            href: typeof to === "string" ? to : "",
          },
          // The trail's text ("Yes, that's them" + chevron) must survive the
          // mock, or the keyboard-reachable control renders EMPTY — the exact
          // failure mode this suite exists to catch.
          children,
        ),
      // The signed-in fixture renders ResultQuickSave on the unmatched row,
      // whose useFetcher needs a router context (house pattern: the
      // dashboard.route.test.ts stub).
      useFetcher: vi.fn().mockReturnValue({
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
        data: undefined,
        state: "idle",
        submit: vi.fn(),
      }),
      useActionData: () => undefined,
      useLoaderData: () => loaderData,
      useLocation: () => locationObj,
      useNavigate: () => navigateMock,
      useNavigation: () => navigationState,
      useRevalidator: () => revalidatorRef,
      useRouteLoaderData: () => routeLoaderData,
    };
  });
  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));
}

const sessionFixture = {
  user: {
    id: "user-likely-confirm",
    email: "likely-confirm@fixture.test",
    name: "Fixture",
  },
  expires: "2027-01-01T00:00:00.000Z",
};

const baseLoaderData: Record<string, unknown> = {
  mode: "advertiser",
  filters: {
    query: "notion.so",
    country: "all",
    platform: "all",
    creativeType: "all",
    status: "all",
    firstSeenFrom: "",
    lastSeenFrom: "",
  },
  fingerprint: "fp-notion-confirm",
  stealSummary: null,
  selectionEnrichmentPending: false,
  landingPageCaptureFailure: null,
  collections: [],
  plan: null,
  competitorWebsite: {
    raw: "https://notion.so",
    normalizedUrl: "https://notion.so",
    host: "notion.so",
    displayName: "Notion",
    searchTerm: "notion.so",
    error: null,
  },
  trackingRole: "competitor",
  inputError: null,
  searchScope: "exact",
  displayDomain: "notion.so",
  relevanceApplied: true,
  watchedWatchlist: null,
  showOpsNav: false,
  showPresenceNav: false,
};

// One likely row (the BET 2 dead-end surface: the advertiser name fits the
// brand, no website link was captured) + one unmatched row, with the likely
// one selected so the detail pane — where the instructional note lives —
// renders too. Shape mirrors the issue 1482 completeLoaderData fixture.
function confirmAd(
  metaAdId: string,
  level: "likely_brand_name" | "unverified_provider_candidate",
  advertiser: string,
): AdRecord {
  return {
    metaAdId,
    advertiser,
    body: "The connected workspace where better, faster work happens.",
    previewHeadline: "One tool for your whole company",
    previewSubhead: "Fixture source evidence",
    hook: "One tool for your whole company",
    offer: "Free for students",
    cta: "Get started",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Live Browser Run fixture",
    source: "meta_library_browser",
    analysisFields: [],
    tags: [],
    domainMatch: {
      level,
      reason:
        level === "likely_brand_name"
          ? "Advertiser name fits this brand"
          : "Returned for 'notion' by the Meta source; no brand website was searched",
      matchedDomain: null,
    },
  } as AdRecord;
}

const LIKELY_AD = confirmAd("meta-confirm-2", "likely_brand_name", "Notion");
const UNMATCHED_AD = confirmAd(
  "meta-confirm-3",
  "unverified_provider_candidate",
  "Notion Templates Co",
);

const resultsLoaderData = (session: Record<string, unknown> | null) => ({
  ...baseLoaderData,
  session,
  selectedAd: LIKELY_AD,
  result: {
    ads: [LIKELY_AD, UNMATCHED_AD],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
    discoveryStatus: "healthy",
    discoverySummary: "Live ad checks are ready",
    discoveryFailureClass: null,
    verifiedCount: 0,
    likelyCount: 1,
    unmatchedCount: 1,
    rawCandidateCount: 2,
  },
});

let cleanupRoot: Root | null = null;
let cleanupContainer: HTMLDivElement | null = null;

async function mountRoute() {
  const { default: SearchRoute } = await import("~/routes/search");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  cleanupRoot = root;
  cleanupContainer = container;
  await act(async () => {
    root.render(createElement(SearchRoute));
  });
  return container;
}

/** The one trail anchor a Likely row renders — the confirm control. */
function likelyRowConfirmAnchor(container: HTMLElement): string | null {
  const anchor = container.querySelector("a.f9-wk-row-confirm");
  return anchor ? anchor.getAttribute("href") : null;
}

/** The detail-pane control that ships with the instructional note. */
function paneConfirmAnchor(container: HTMLElement): string | null {
  const acts = container.querySelectorAll(".f9-wk-acts a.f9-wk-lnk");
  const withSource = Array.from(acts).find((a) =>
    (a.getAttribute("href") ?? "").includes("search-likely-confirm"),
  );
  const record = Array.from(acts).find((a) =>
    (a.getAttribute("href") ?? "").includes("selected=meta-confirm-2"),
  );
  const found = withSource ?? record;
  return found ? found.getAttribute("href") : null;
}

beforeEach(() => {
  // Mirror the streaming suite: fake only the timers so the mounted route's
  // warming/revalidate effects cannot run away; Date stays real.
  vi.useFakeTimers({
    toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"],
  });
  revalidatorRef = { state: "idle", revalidate: vi.fn() };
  navigateMock = vi.fn();
  navigationState = { state: "idle", location: null };
  locationObj = { pathname: "/search", search: SEARCH, hash: "" };
  vi.resetModules();
  mockRouter();
});

afterEach(async () => {
  if (cleanupRoot) {
    await act(async () => cleanupRoot?.unmount());
  }
  cleanupContainer?.remove();
  cleanupRoot = null;
  cleanupContainer = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe("Likely-match confirm control on /search (issue 3306, BET 2 finish line)", () => {
  it("signed-out: the Likely row's confirm control is the signup intent carrying the searched domain, and the note ships with a working control", async () => {
    loaderData = resultsLoaderData(null);
    routeLoaderData = { session: null };
    const container = await mountRoute();
    const markup = container.innerHTML;

    // The instructional note renders — the copy the issue quotes.
    expect(markup).toContain("Likely match");
    expect(markup).toContain("Confirm");

    // (Accept-1) the Likely ROW renders a real, keyboard-reachable control —
    // an anchor, not instructional copy alone. Exactly one: the unmatched row
    // renders no confirm trail.
    expect(container.querySelectorAll("a.f9-wk-row-confirm")).toHaveLength(1);
    expect(container.textContent).toContain("Yes, that\u2019s them");

    // (Accept-2) its destination IS the signup intent: the Track-wall
    // redirectTo shape carrying the searched domain, plus the allowlisted
    // attribution marker.
    const href = likelyRowConfirmAnchor(container);
    expect(href).not.toBeNull();
    expect(href!.startsWith("/auth/signup?redirectTo=")).toBe(true);
    expect(href!.endsWith("&source=search-likely-confirm")).toBe(true);
    const decoded = decodeURIComponent(href!);
    expect(decoded).toContain("redirectTo=/app?website=");
    // Track-wall shape (extension-domain.test.ts precedent): redirectTo is
    // encoded once and the website inside it again, so the readable domain
    // needs a second decode — exactly what the setup checklist does.
    const setupQuery = decodeURIComponent(
      decoded.split("redirectTo=")[1]!.split("&")[0]!,
    );
    expect(setupQuery).toContain("website=https://notion.so");
    expect(setupQuery).toContain("#setup-checklist");

    // The instructional note never ships without its working control: the
    // detail pane's note is joined by the same confirm control.
    expect(markup).toContain("Confirm");
    expect(paneConfirmAnchor(container)).toBe(href);
  });

  it("signed-in: the Likely confirm control keeps the record href (the ?selected= reload that persists the confirmation)", async () => {
    loaderData = resultsLoaderData(sessionFixture);
    routeLoaderData = { session: sessionFixture };
    const container = await mountRoute();

    // The confirm control stays on the Likely row, but its destination is the
    // selection reload — the click that records through the existing
    // selection/search persistence (proven against real D1 by the workers
    // integration suite). It is not the signup intent here.
    const href = likelyRowConfirmAnchor(container);
    expect(href).not.toBeNull();
    expect(href).toContain("selected=meta-confirm-2");
    expect(href).not.toContain("/auth/signup");

    // The pane's confirm offers the same record click — repeat clicks are
    // idempotent by the upsert, so the same href is the correct signal.
    expect(paneConfirmAnchor(container)).toBe(href);
  });
});
