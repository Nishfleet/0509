import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureValidityReasonCode } from "~/lib/capture-validity.server";
import {
  CAPTURE_RULES_PUBLIC_PATH,
  CAPTURE_VALIDITY_PUBLIC_PATH,
  CAPTURE_VALIDITY_PUBLIC_RULES,
} from "~/lib/capture-validity-public-rules";

const routePath = "app/routes/capture-rules.tsx";
const redirectPath = "app/routes/proof.tsx";
const routesPath = "app/routes.ts";
const marketingPath = "app/routes/marketing.tsx";

const ISSUE_953_TEST_SOURCES = [
  readFileSync("tests/capture-validity-termination.test.ts", "utf8"),
  readFileSync("tests/capture-validity.test.ts", "utf8"),
  readFileSync("tests/capture-validity-pipeline.test.ts", "utf8"),
  readFileSync("tests/capture-validity-corroboration.test.ts", "utf8"),
].join("\n");

const REQUIRED_ISSUE_970_TITLES = [
  "Error pages",
  "Challenge pages",
  "Cookie and consent walls",
  "Partial loads",
  "Site down, then back",
  "Timestamp-only edits",
  "Rotating banners",
] as const;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      useRouteLoaderData: () => undefined,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("public capture-validity rules page (#970, #1432)", () => {
  it("has a single canonical public path at /capture-rules", () => {
    expect(CAPTURE_VALIDITY_PUBLIC_PATH).toBe("/capture-rules");
    expect(CAPTURE_RULES_PUBLIC_PATH).toBe("/capture-rules");
  });

  it("is registered at /capture-rules with a truthful title, description, and canonical", () => {
    const source = readFileSync(routePath, "utf8");
    const routes = readFileSync(routesPath, "utf8");

    expect(routes).toContain('route("capture-rules", "routes/capture-rules.tsx")');
    expect(routes).toContain('route("proof", "routes/proof.tsx")');
    expect(source).toContain(`pathname: CAPTURE_RULES_PUBLIC_PATH`);
    expect(source).toContain('title: "What we refuse to alert on | Five to Nine"');

    const description =
      "The landing-page captures Five to Nine refuses to turn into alerts: error pages, bot walls, cookie walls, partial loads, and churn that is not a real change.";
    expect(description.length).toBeLessThanOrEqual(160);
    expect(source).toContain(description);
  });

  it("renders every required refuse rule in plain language", async () => {
    const { default: CaptureRulesRoute } = await import("~/routes/capture-rules");
    const markup = renderToStaticMarkup(createElement(CaptureRulesRoute));

    expect(markup).toContain("What we refuse to alert on");
    expect(markup).toContain("If we send an alert, the page really changed");
    expect(markup).toContain("A failed capture is recorded as failed. It is never an alert.");

    for (const title of REQUIRED_ISSUE_970_TITLES) {
      expect(markup).toContain(title);
    }

    for (const rule of CAPTURE_VALIDITY_PUBLIC_RULES) {
      expect(markup).toContain(`id="${rule.id}"`);
      expect(markup).toContain(rule.title);
      expect(markup).toContain(rule.refused);
      expect(markup).toContain(rule.why);
    }
  });

  it("maps every listed rule to a #953 gate, suppression, or classifier", () => {
    const reasonCodes: CaptureValidityReasonCode[] = [
      "landing_challenge_page",
      "landing_cookie_wall",
      "landing_partial_spa",
      "landing_error_page",
      "landing_content_signature_too_small",
    ];

    expect(CAPTURE_VALIDITY_PUBLIC_RULES.length).toBeGreaterThanOrEqual(
      REQUIRED_ISSUE_970_TITLES.length,
    );

    for (const rule of CAPTURE_VALIDITY_PUBLIC_RULES) {
      expect(ISSUE_953_TEST_SOURCES).toContain(rule.issue953Anchor);

      if (rule.gate.kind === "reason_code") {
        expect(reasonCodes).toContain(rule.gate.code);
      } else if (rule.gate.kind === "extractor_suppression") {
        expect(["churn_stable", "ad_slot_strip"]).toContain(rule.gate.code);
      } else if (rule.gate.kind === "classifier") {
        expect(rule.gate.code).toBe("maintenance_window");
      } else {
        expect(rule.gate.code).toBe("screenshot_corroboration");
      }
    }
  });

  it("keeps competitor comparison copy out of the public rules page", async () => {
    const { default: CaptureRulesRoute } = await import("~/routes/capture-rules");
    const markup = renderToStaticMarkup(createElement(CaptureRulesRoute));
    const source = readFileSync(routePath, "utf8");
    const combined = `${source}\n${markup}`;

    expect(combined).not.toMatch(/visualping|magicbrief|spyland|pulzifi|foreplay|pagecrawl|panoramata/i);
    expect(combined).not.toMatch(/#1|best competitor|nobody advertises/i);
  });

  it("is linked from the homepage proof claim", async () => {
    const marketing = readFileSync(marketingPath, "utf8");
    expect(marketing).toContain('className="ld-rec" to="/capture-rules"');
    expect(marketing).toContain("Proof-backed brief");
    expect(marketing).toContain('to="/capture-rules">What we refuse to alert on');

    const { default: Marketing } = await import("~/routes/marketing");
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
          React.createElement("form", props, children),
        Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useRouteLoaderData: vi.fn().mockReturnValue({
          pricingPlans: [],
          usageBundles: [],
          session: null,
        }),
        useLoaderData: vi.fn().mockReturnValue({
          pricingPreview: { available: false },
          commercialLaunch: {
            scoutSaleOpen: true,
            starterSaleOpen: true,
            agencySaleOpen: false,
          },
          proofBrief: null,
        }),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      };
    });
    vi.resetModules();
    const { default: FreshMarketing } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(FreshMarketing));
    expect(markup).toContain('href="/capture-rules"');
    expect(markup).toContain("Proof-backed brief");
    expect(markup).toContain("What we refuse to alert on");
    expect(FreshMarketing).toBeTruthy();
    expect(Marketing).toBeTruthy();
  });

  it("emits WebPage JSON-LD matching the visible title and canonical", async () => {
    const { default: CaptureRulesRoute } = await import("~/routes/capture-rules");
    const markup = renderToStaticMarkup(createElement(CaptureRulesRoute));
    const match = markup.match(/type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const block = JSON.parse(match![1]!) as Record<string, unknown>;
    expect(block["@type"]).toBe("WebPage");
    expect(block.name).toBe("What we refuse to alert on | Five to Nine");
    expect(block.url).toBe("https://0509.io/capture-rules");
  });

  it("/proof 301-redirects to the canonical /capture-rules", async () => {
    const redirectSource = readFileSync(redirectPath, "utf8");
    const routes = readFileSync(routesPath, "utf8");

    expect(routes).toContain('route("proof", "routes/proof.tsx")');
    expect(redirectSource).toContain("301");
    expect(redirectSource).toContain("CAPTURE_RULES_PUBLIC_PATH");

    const { loader } = await import("~/routes/proof");
    const response = loader({} as never);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/capture-rules");
  });
});
