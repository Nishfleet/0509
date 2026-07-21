import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const collection = {
  id: "collection-1",
  userId: "user-1",
  name: "Launch proof",
  description: "Current competitor examples",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

function createContext() {
  return { cloudflare: { env: {} } };
}

function installRouterMocks(input: { loaderData: unknown; actionData?: unknown }) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) => React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(input.actionData),
      useLoaderData: vi.fn().mockReturnValue(input.loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle", formData: null, location: null }),
      useSearchParams: vi.fn().mockReturnValue([new URLSearchParams(), vi.fn()]),
    };
  });
}

function collectionLoaderData(
  plan: "free" | "scout" | "starter" | "agency",
  collections = [collection],
) {
  return {
    collections,
    plan,
    selectedCollection: collections[0] ?? null,
    items: [],
  };
}

async function renderCollections(
  plan: "free" | "scout" | "starter" | "agency",
  collections = [collection],
) {
  installRouterMocks({ loaderData: collectionLoaderData(plan, collections) });
  const { default: CollectionsRoute } = await import("~/routes/app.collections");
  return renderToStaticMarkup(createElement(CollectionsRoute));
}

async function renderReportsLocked(plan: "free" | "scout" | "starter") {
  installRouterMocks({
    loaderData: {
      accessDenied: true,
      pdfAvailable: false,
      plan,
      preparedBy: null,
      report: null,
    },
  });
  const { default: ReportsRoute } = await import("~/routes/app.reports");
  return renderToStaticMarkup(createElement(ReportsRoute));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("collection plan controls", () => {
  it("locks collection creation before click for Free", async () => {
    const markup = await renderCollections("free", []);

    expect(markup).toContain("Collections are not included on this plan");
    expect(markup).toContain("Collections start on the Scout plan.");
    expect(markup).toContain('href="/app/billing?source=limit#plans"');
    expect(markup).not.toContain('name="intent" value="create-collection"');
    expect(markup).not.toContain('placeholder="Nykaa competitors"');
  });

  it("keeps collection creation available for Scout below its limit", async () => {
    const markup = await renderCollections("scout");

    expect(markup).toContain('name="intent" value="create-collection"');
    expect(markup).toContain('placeholder="Competitor set A"');
    expect(markup).toContain("Create collection");
    expect(markup).not.toContain("Collections are not included on this plan");
  });

  it("locks report, CSV/JSON export, and share before click for Scout", async () => {
    const markup = await renderCollections("scout");

    expect(markup).toContain("Open report (Agency only)");
    expect(markup).toContain("Upgrade to Agency");
    expect(markup).toContain("Upgrade to Starter for exports");
    expect(markup).toContain("Upgrade to Agency to share");
    expect(markup).not.toContain('href="/app/reports/collection:collection-1"');
    expect(markup).not.toContain("/export/collection/collection-1");
    expect(markup).not.toContain("name=\"intent\" value=\"share-collection\"");
  });

  it("keeps Starter export + watermarked share while locking Agency-only report", async () => {
    const markup = await renderCollections("starter");

    expect(markup).toContain('href="/export/collection/collection-1"');
    expect(markup).toContain('href="/export/collection/collection-1?format=json"');
    expect(markup).toContain("Upgrade to Agency");
    // WP-29: Starter gets watermarked share links; reports stay Agency-only.
    expect(markup).toContain('name="intent" value="share-collection"');
    expect(markup).toContain("Create share link");
    expect(markup).not.toContain("Upgrade to Agency to share");
    expect(markup).not.toContain("Upgrade to Starter for exports");
    expect(markup).not.toContain('href="/app/reports/collection:collection-1"');
  });

  it("keeps all collection controls working for Agency", async () => {
    const markup = await renderCollections("agency");

    expect(markup).toContain('href="/app/reports/collection:collection-1"');
    expect(markup).toContain('href="/export/collection/collection-1"');
    expect(markup).toContain('href="/export/collection/collection-1?format=json"');
    expect(markup).toContain("name=\"intent\" value=\"share-collection\"");
    expect(markup).toContain("Create share link");
    expect(markup).not.toContain("Upgrade to Agency to share");
  });
});

describe("collection share action", () => {
  function installActionMocks(plan: "scout" | "starter" | "agency") {
    const createShareLink = vi.fn().mockResolvedValue({ token: "share-token" });

    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session: { user: { id: "user-1", email: "owner@example.com" }, session: { id: "session-1" } },
        workspaceUserId: "user-1",
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: () => ({}) }));
    vi.doMock("~/lib/with-workspace.server", () => ({ requireWorkspacePlanLimit: vi.fn() }));
    vi.doMock("~/lib/data.server", () => ({
      addExternalProofToCollection: vi.fn(),
      createCollectionWithinLimit: vi.fn(),
      createShareLink,
      getCollection: vi.fn().mockResolvedValue(collection),
      updateCollectionItem: vi.fn(),
    }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      planFeatureDeniedActionResult: (feature: string, deniedPlan: string) => ({
        ok: false,
        error: "plan_gated",
        feature,
        plan: deniedPlan,
        message: "This capability is not included in your current plan.",
      }),
      // WP-29: share_links from Starter up; only Scout stays gated.
      requireWorkspacePlanFeature: vi.fn().mockResolvedValue(
        plan === "scout"
          ? {
              ok: false,
              plan,
              response: new Response("plan gated", { status: 403 }),
            }
          : { ok: true, plan },
      ),
    }));

    return createShareLink;
  }

  async function runShareAction(plan: "scout" | "starter" | "agency") {
    const createShareLink = installActionMocks(plan);
    const { action } = await import("~/routes/app.collections");
    const formData = new FormData();
    formData.set("intent", "share-collection");
    formData.set("collectionId", collection.id);
    const result = await action({
      context: createContext(),
      request: new Request("https://0509.io/app/collections", { method: "POST", body: formData }),
    } as never);
    return { createShareLink, result };
  }

  it("returns structured recovery when Scout tries to share", async () => {
    const { createShareLink, result } = await runShareAction("scout");

    expect(result).toMatchObject({
      error: "plan_gated",
      feature: "share_links",
      intent: "share-collection",
      plan: "scout",
      upgradePath: "/app/billing?source=collections#plans",
    });
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it.each(["starter", "agency"] as const)("keeps the %s share action successful", async (plan) => {
    const { createShareLink, result } = await runShareAction(plan);

    expect(result).toMatchObject({
      ok: true,
      intent: "share-collection",
      message: "Share link created.",
      shareUrl: "https://0509.io/share/share-token",
    });
    expect(createShareLink).toHaveBeenCalledTimes(1);
  });
});

describe("reports plan state", () => {
  it.each(["free", "scout", "starter"] as const)("renders an upgrade state for %s", async (plan) => {
    const markup = await renderReportsLocked(plan);

    expect(markup).toContain("Client-ready reports");
    expect(markup).toContain("Open client-ready reports and share the evidence with your team");
    expect(markup).toContain("included in the Agency plan.");
    expect(markup).toContain('href="/app/billing?source=reports#plans"');
    expect(markup).toContain("Upgrade to Agency");
    expect(markup).not.toContain("Access denied");
    expect(markup).not.toContain("is-error");
  });

  it("returns a useful loader state instead of throwing for non-Agency plans", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session: { user: { id: "user-1" } },
        workspaceUserId: "user-1",
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: () => ({}) }));
    vi.doMock("~/lib/plan-feature-gate.server", () => ({
      requireWorkspacePlanFeature: vi.fn().mockResolvedValue({
        ok: false,
        plan: "starter",
        response: new Response("plan gated", { status: 403 }),
      }),
      resolveWorkspacePreparedBy: vi.fn(),
    }));

    const { loader } = await import("~/routes/app.reports");
    const result = await loader({
      context: createContext(),
      params: { id: "collection:collection-1" },
      request: new Request("https://0509.io/app/reports/collection:collection-1"),
    } as never);

    expect(result).toMatchObject({ accessDenied: true, plan: "starter", report: null });
  });
});
