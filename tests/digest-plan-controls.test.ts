import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAN_LIMITS } from "~/lib/plan-entitlements";

type MockProps = { children?: ReactNode } & Record<string, unknown>;

const digest = {
  id: "digest-1",
  userId: "user-1",
  periodStart: "2026-07-01T00:00:00.000Z",
  periodEnd: "2026-07-07T00:00:00.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  summary: {},
  items: [
    {
      id: "item-1",
      digestRunId: "digest-1",
      watchlistId: "watch-1",
      watchlistName: "Example watch",
      eventType: "offer_changed",
      title: "Offer changed",
      summary: "The offer changed.",
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z",
    },
  ],
  delivery: null,
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderDigest(
  plan: "free" | "scout" | "starter" | "agency",
  state: "filed" | "empty" | "locked" = "filed",
) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, ...props }: MockProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockProps & { to?: string }) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(
        state === "locked"
          ? {
              digests: [],
              selectedDigest: null,
              selectedDigestAttempts: [],
              digestAttemptsByDigestId: {},
              canAccessDigests: false,
              plan,
            }
          : state === "empty"
            ? {
                digests: [],
                selectedDigest: null,
                selectedDigestAttempts: [],
                digestAttemptsByDigestId: {},
                canAccessDigests: true,
                plan,
              }
            : {
              digests: [digest],
              selectedDigest: digest,
              selectedDigestAttempts: [],
              digestAttemptsByDigestId: {},
              canAccessDigests: true,
              plan,
            },
      ),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useSearchParams: vi.fn().mockReturnValue([new URLSearchParams("digest=digest-1"), vi.fn()]),
    };
  });
  vi.doMock("~/components/digest-intelligence", () => ({
    DesignedDigestBrief: ({ actions }: MockProps & { actions?: ReactNode }) =>
      createElement("article", null, actions),
    DigestIntelligence: () => null,
    DigestMovementSummary: () => null,
    DigestProofPacket: () => null,
  }));
  vi.doMock("~/components/local-time", () => ({ LocalTime: () => null }));
  vi.doMock("~/components/proof-glossary", () => ({ ProofGlossary: () => null }));
  vi.doMock("~/components/dashboard-page", () => ({
    DashboardPage: ({ children }: MockProps) => children,
    DashboardPageHeader: () => null,
  }));

  const { default: DigestsRoute } = await import("~/routes/app.digests");
  return renderToStaticMarkup(createElement(DigestsRoute));
}

describe("digest plan-aware controls", () => {
  it.each(["free", "scout", "starter", "agency"] as const)(
    "keeps retained Briefs access enabled by the canonical %s plan contract",
    (plan) => {
      expect(PLAN_LIMITS[plan].digests).toBe(true);
    },
  );

  it("returns a structured share gate before creating a digest link on Scout", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session: { user: { id: "user-1", email: "owner@example.com", name: "Owner" } },
        workspaceUserId: "user-1",
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/plan.server", () => ({
      PLAN_LIMITS: { scout: { digests: true } },
      getUserPlan: vi.fn().mockResolvedValue("scout"),
    }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      requireWorkspacePlanFeature: vi.fn().mockResolvedValue({ ok: false, plan: "scout" }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      createShareLink: vi.fn(),
      getDigest: vi.fn(),
    }));

    const { action } = await import("~/routes/app.digests");
    const formData = new FormData();
    formData.set("intent", "share-digest");
    formData.set("digestId", "digest-1");

    const result = await action({
      context: { cloudflare: { env: {} } },
      request: new Request("http://localhost/app/digests", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: false,
      error: "plan_gated",
      feature: "share_links",
      plan: "scout",
    });
  });

  it("keeps free activation honest with an upgrade state and no recurring controls", async () => {
    const markup = await renderDigest("free", "locked");

    expect(markup).toContain("Competitor change briefs");
    expect(markup).toContain("See plans");
    expect(markup).toContain('href="/app/billing?source=digests#plans"');
    expect(markup).not.toContain("Export CSV");
    expect(markup).not.toContain("Share snapshot");
  });

  it.each([
    ["free", false, false],
    ["scout", false, false],
    ["starter", true, true],
    ["agency", true, true],
  ] as const)("shows honest export/share controls for %s", async (plan, canExport, canShare) => {
    const markup = await renderDigest(plan);

    expect(markup).toContain(canExport ? "Export CSV" : "Upgrade for exports");
    expect(markup).toContain(canShare ? "Share snapshot" : "Upgrade to share");
    expect(markup).not.toContain(canExport ? "Upgrade for exports" : "/export/digest/digest-1");
    expect(markup).not.toContain(canShare ? "Upgrade to share" : 'name="intent" value="share-digest"');
  });

  it.each(["free", "scout", "starter", "agency"] as const)(
    "shows the same honest first-brief action for the %s empty state",
    async (plan) => {
      const markup = await renderDigest(plan, "empty");

      expect(markup).toContain("Your first brief lands after the first scan");
      expect(markup).toContain("Add competitor");
      expect(markup).toContain('href="/search"');
      expect(markup).not.toContain("Export CSV");
      expect(markup).not.toContain("Export JSON");
      expect(markup).not.toContain("Share snapshot");
      expect(markup).not.toContain("Upgrade for exports");
      expect(markup).not.toContain("Upgrade to share");
    },
  );
});
