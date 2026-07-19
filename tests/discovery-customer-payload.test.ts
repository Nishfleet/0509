import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rawDiscoveryStatus = {
  status: "degraded",
  provider: "meta_library_browser",
  mode: "live",
  summary: "RAW_PROVIDER_MESSAGE_SENTINEL: provider metadata and stack details",
  lastCheckedAt: "2026-07-15T10:00:00.000Z",
  lastErrorCode: "RAW_ERROR_CODE_SENTINEL",
  lastErrorMessage:
    "RAW_ERROR_MESSAGE_SENTINEL https://provider.example/token?secret=abc",
} as const;

const rawConnection = {
  userId: "user-1",
  encryptedAccessToken: "RAW_ENCRYPTED_TOKEN_SENTINEL",
  tokenLastFour: "1234",
  tokenFingerprint: "RAW_TOKEN_FINGERPRINT_SENTINEL",
  status: "degraded",
  summary: "RAW_CONNECTION_SUMMARY_SENTINEL",
  lastCheckedAt: "2026-07-15T10:00:00.000Z",
  lastErrorCode: "RAW_CONNECTION_CODE_SENTINEL",
  lastErrorMessage: "RAW_CONNECTION_MESSAGE_SENTINEL",
  createdAt: "2026-07-15T09:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z",
} as const;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("customer discovery payloads", () => {
  it("maps known and unknown failures to stable customer-safe copy", async () => {
    const { customerDiscoverySummary, toCustomerDiscoveryStatus } =
      await import("~/lib/discovery-customer-copy");

    expect(
      toCustomerDiscoveryStatus({
        ...rawDiscoveryStatus,
        lastErrorCode: "login_wall",
        summary:
          "Cached live results are available, but fresh discovery is degraded.",
      }),
    ).toEqual({
      status: "degraded",
      summary:
        "Live ad checks are temporarily delayed, so we're showing your most recent results. We'll retry automatically.",
      lastCheckedAt: rawDiscoveryStatus.lastCheckedAt,
      recovery: "Check source access, then retry once it's ready.",
    });

    expect(
      toCustomerDiscoveryStatus({
        ...rawDiscoveryStatus,
        lastErrorCode: "UNKNOWN_RAW_FAILURE_CODE",
      }),
    ).toEqual({
      status: "degraded",
      summary:
        "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.",
      lastCheckedAt: rawDiscoveryStatus.lastCheckedAt,
      recovery: "Check source access, then retry once it's ready.",
    });

    const unavailable = toCustomerDiscoveryStatus({
      status: "disabled",
      summary: "RAW_DISABLED_PROVIDER_SENTINEL",
      lastCheckedAt: null,
    });
    expect(customerDiscoverySummary(unavailable.summary)).toBe(
      "Live ad checks are unavailable right now. Review source access before relying on fresh results.",
    );
  });

  it("removes raw discovery and connection diagnostics at the source-access loader boundary", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi
        .fn()
        .mockResolvedValue({ workspaceUserId: "user-1", isMember: false }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialAdSourceStatus: vi
        .fn()
        .mockResolvedValue(rawDiscoveryStatus),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getCustomerMetaConnection: vi.fn().mockResolvedValue(rawConnection),
    }));

    const { loader } = await import("~/routes/app.source-access");
    const result = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/app/source-access"),
    } as never);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("RAW_PROVIDER_MESSAGE_SENTINEL");
    expect(serialized).not.toContain("RAW_ERROR_CODE_SENTINEL");
    expect(serialized).not.toContain("RAW_ERROR_MESSAGE_SENTINEL");
    expect(serialized).not.toContain("RAW_ENCRYPTED_TOKEN_SENTINEL");
    expect(serialized).not.toContain("RAW_TOKEN_FINGERPRINT_SENTINEL");
    expect(result).toMatchObject({
      connection: {
        status: "degraded",
        tokenLastFour: "1234",
      },
      discoveryStatus: {
        status: "degraded",
        recovery: "Check source access, then retry once it's ready.",
      },
    });
    expect(result.connection).not.toHaveProperty("lastErrorMessage");
    expect(result.discoveryStatus).not.toHaveProperty("provider");
  });

  it("does not echo raw discovery diagnostics into source-access HTML", async () => {
    vi.doMock("react-router", async () => {
      const actual =
        await vi.importActual<typeof import("react-router")>("react-router");
      return {
        ...actual,
        Form: ({
          children,
          ...props
        }: { children?: ReactNode } & Record<string, unknown>) =>
          createElement("form", props, children),
        Link: ({
          children,
          to,
          ...props
        }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
          createElement("a", { ...props, href: to ?? "" }, children),
        useActionData: vi.fn().mockReturnValue(undefined),
        useNavigation: vi
          .fn()
          .mockReturnValue({ state: "idle", formData: null }),
        useLoaderData: vi.fn().mockReturnValue({
          connection: {
            status: "degraded",
            tokenLastFour: "1234",
            summary: rawConnection.summary,
            lastCheckedAt: rawConnection.lastCheckedAt,
            lastErrorMessage: rawConnection.lastErrorMessage,
          },
          discoveryStatus: rawDiscoveryStatus,
        }),
      };
    });

    const { default: SourceAccessRoute } =
      await import("~/routes/app.source-access");
    const markup = renderToStaticMarkup(createElement(SourceAccessRoute));

    expect(markup).not.toContain("RAW_PROVIDER_MESSAGE_SENTINEL");
    expect(markup).not.toContain("RAW_ERROR_MESSAGE_SENTINEL");
    expect(markup).toContain("Live ad checks are temporarily delayed");
  });
});
