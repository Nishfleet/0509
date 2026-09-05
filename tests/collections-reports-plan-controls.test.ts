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

function installRouterMocks(input: {
  loaderData: unknown;
  actionData?: unknown;
  params?: Record<string, string>;
}) {
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
      useParams: vi.fn().mockReturnValue(input.params ?? {}),
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
  actionData?: unknown,
) {
  installRouterMocks({
    loaderData: collectionLoaderData(plan, collections),
    actionData,
  });
  const { default: CollectionsRoute } = await import("~/routes/app.collections");
  return renderToStaticMarkup(createElement(CollectionsRoute));
}

async function renderReportsLocked(
  plan: "free" | "scout" | "starter",
  params: Record<string, string> = {},
) {
  // Each render installs its own params mock, so the route module has to be
  // re-imported rather than served from the registry.
  vi.resetModules();
  installRouterMocks({
    loaderData: {
      accessDenied: true,
      pdfAvailable: false,
      plan,
      preparedBy: null,
      report: null,
      upgradePath: "/app/billing?source=reports#plans",
    },
    params,
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
  it("lets Free create its first Collection instead of gating", async () => {
    const markup = await renderCollections("free", []);

    // Honest 1-coll: Free includes exactly one Collection, so the empty
    // Library shows the first-run create panel, not an upgrade wall.
    expect(markup).not.toContain("f9-library-locked");
    expect(markup).not.toContain("Collections start on Scout");
    expect(markup).toContain('name="intent" value="create-collection"');
    expect(markup).toContain("Start your first collection");
    expect(markup.match(/f9-wk-btn/g) ?? []).toHaveLength(1);
  });

  it("keeps a downgraded Free Collection visible and honestly reports the 1-Collection limit", async () => {
    const markup = await renderCollections("free");

    expect(markup).toContain("Launch proof");
    expect(markup).toContain("Collection limit reached");
    expect(markup).toContain("You are using all 1 Collection on this plan.");
    expect(markup).not.toContain("New collections start on Scout");
    expect(markup).not.toContain("Free does not include new collections");
    expect(markup).not.toContain("using all 0 collections");
    expect(markup).not.toContain('name="intent" value="create-collection"');
    expect(markup).toContain("View upgrade options");
  });

  it("keeps collection creation available for Scout below its limit", async () => {
    const markup = await renderCollections("scout");

    expect(markup).toContain('name="intent" value="create-collection"');
    expect(markup).toContain('placeholder="Competitor set A"');
    expect(markup).toContain("Create collection");
    expect(markup).not.toContain("Collections are not included on this plan");
  });

  it.each([
    ["first-run", []],
    ["disclosure", [collection]],
  ])("renders failed create feedback once inside the %s form", async (_mode, collections) => {
    const message = "Give the collection a name first.";
    const markup = await renderCollections("scout", collections, {
      ok: false,
      intent: "create-collection",
      message,
    });
    const feedbackIndex = markup.indexOf(message);
    const formStart = markup.lastIndexOf("<form", feedbackIndex);
    const formEnd = markup.indexOf("</form>", feedbackIndex);

    expect(markup.split(message)).toHaveLength(2);
    expect(formStart).toBeGreaterThanOrEqual(0);
    expect(feedbackIndex).toBeGreaterThan(formStart);
    expect(formEnd).toBeGreaterThan(feedbackIndex);
  });

  it("keeps unrelated feedback out of the create form", async () => {
    const message = "Collection note could not be updated.";
    const markup = await renderCollections("scout", [collection], {
      ok: false,
      intent: "update-item",
      message,
    });
    const feedbackIndex = markup.indexOf(message);
    const createFormIndex = markup.indexOf('name="intent" value="create-collection"');

    expect(markup.match(/Collection note could not be updated\./g) ?? []).toHaveLength(1);
    expect(feedbackIndex).toBeGreaterThanOrEqual(0);
    expect(createFormIndex).toBeGreaterThan(feedbackIndex);
  });

  it("locks report, CSV/JSON export, and share behind ONE nudge for Scout", async () => {
    const markup = await renderCollections("scout");

    // BL-014 (brief §5, retired styles): three locked actions collapse into a
    // single Rank-2 nudge instead of a disabled button plus a floating
    // "Upgrade to Agency" text link in the right rail.
    expect(markup).toContain("Upgrade to unlock client reports, exports &amp; share links");
    expect(markup).toContain("View upgrade options");
    expect(markup).not.toContain("Open report (Agency only)");
    expect(markup).not.toContain("Upgrade to Starter for exports");
    expect(markup).not.toContain("Upgrade to Agency to share");
    expect(markup).not.toContain("f9-text-link");
    expect(markup).not.toContain('href="/app/reports/collection:collection-1"');
    expect(markup).not.toContain("/export/collection/collection-1");
    expect(markup).not.toContain("name=\"intent\" value=\"share-collection\"");
  });

  it("keeps Starter export + watermarked share while locking Agency-only report", async () => {
    const markup = await renderCollections("starter");

    expect(markup).toContain('href="/export/collection/collection-1"');
    expect(markup).toContain('href="/export/collection/collection-1?format=json"');
    expect(markup).toContain("Upgrade to unlock client reports");
    expect(markup).toContain("View upgrade options");
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

  it("renders the gate as a quiet v4 explanation, not a specimen panel", async () => {
    const markup = await renderReportsLocked("starter");

    expect(markup).toContain("f9-wk-reports-locked f9-locked-feature");
    expect(markup).toContain("Everything stays private until you choose to send it.");
    expect(markup).toContain("Your workspace evidence is not used as an upgrade preview.");
    expect(markup).not.toContain("f9-evidence-specimen");
    expect(markup).not.toContain("f9-evidence-specimen-slot");
    expect(markup).not.toContain("Sample · not your workspace");
    expect(markup.match(/f9-wk-btn/g) ?? []).toHaveLength(1);
    expect(markup).not.toContain("f9-primary-button");
  });

  it("keeps the report kind the URL already revealed, and nothing else, across the gate", async () => {
    const competitor = await renderReportsLocked("starter", {
      id: "watchlist:watch-1",
    });
    expect(competitor).toContain("Competitor report");
    expect(competitor).not.toContain("Collection report");
    // The report itself never crosses the gate.
    expect(competitor).not.toContain("watch-1");

    const collection = await renderReportsLocked("starter", {
      id: "collection:collection-1",
    });
    expect(collection).toContain("Collection report");

    const index = await renderReportsLocked("starter");
    expect(index).not.toContain("Competitor report");
    expect(index).not.toContain("Collection report");
  });

  it("returns a useful loader state instead of throwing for non-Agency plans", async () => {
    const loadOwnedReportDocument = vi.fn();
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
    vi.doMock("~/lib/report-loader.server", () => ({ loadOwnedReportDocument }));

    const { loader } = await import("~/routes/app.reports");
    const result = await loader({
      context: createContext(),
      params: { id: "collection:collection-1" },
      request: new Request("https://0509.io/app/reports/collection:collection-1"),
    } as never);

    expect(result).toMatchObject({ accessDenied: true, plan: "starter", report: null });
    expect(loadOwnedReportDocument).not.toHaveBeenCalled();
  });
});
