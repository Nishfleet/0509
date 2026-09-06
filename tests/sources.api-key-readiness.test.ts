import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

async function mockRouter(loaderData: unknown, actionData?: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(actionData),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("developer access route API-key readiness", () => {
  it("renders missing write-key state and blocked credential lifecycle", async () => {
    await mockRouter({
      canCreateApiKeys: true,
      createDisabledReason: null,
      apiKeys: [],
    });

    const { default: DeveloperAccessRoute } = await import("~/routes/app.developer-access");
    const markup = renderToStaticMarkup(createElement(DeveloperAccessRoute));

    expect(markup).toContain("0 active keys · 0 with approved actions");
    expect(markup).toContain("No API keys yet");
    expect(markup).toContain("Allow approved account actions");
    expect(markup).toContain("API docs");
  });

  it("explains plan-gated API keys before submit", async () => {
    await mockRouter({
      canCreateApiKeys: false,
      createDisabledReason: "Developer access is included in the Agency plan. Upgrade to Agency to create API keys.",
      apiKeys: [],
    });

    const { default: DeveloperAccessRoute } = await import("~/routes/app.developer-access");
    const markup = renderToStaticMarkup(createElement(DeveloperAccessRoute));

    expect(markup).toContain("Developer access is included in the Agency plan. Upgrade to Agency to create API keys.");
    expect(markup).toContain("Developer access is on Agency");
    expect(markup).toContain(
      'href="/app/billing?source=developer-access#plans"',
    );
    expect(markup).not.toContain('name="apiKeyName"');
  });

  it("keeps member-managed developer access quiet and owner-only", async () => {
    await mockRouter({
      canCreateApiKeys: false,
      createDisabledReason:
        "Only Owner can create or revoke API keys for this workspace.",
      apiKeys: [],
    });

    const { default: DeveloperAccessRoute } = await import(
      "~/routes/app.developer-access"
    );
    const markup = renderToStaticMarkup(createElement(DeveloperAccessRoute));

    expect(markup).toContain("API keys are managed by the account owner");
    expect(markup).toContain(
      "Only Owner can create or revoke API keys for this workspace.",
    );
    expect(markup).not.toContain("Upgrade to Agency");
    expect(markup).not.toContain('name="apiKeyName"');
    expect(markup).toContain("No keys are visible to workspace members");
  });

  it("counts active keys and write-enabled keys separately", async () => {
    await mockRouter({
      canCreateApiKeys: true,
      createDisabledReason: null,
      apiKeys: [
        {
          id: "api-key-read",
          name: "Read only",
          keyPrefix: "f9_live_read",
          actionsWriteEnabled: false,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "api-key-write",
          name: "Agent actions",
          keyPrefix: "f9_live_write",
          actionsWriteEnabled: true,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-06-02T00:00:00.000Z",
        },
        {
          id: "api-key-revoked",
          name: "Old write key",
          keyPrefix: "f9_live_old",
          actionsWriteEnabled: true,
          lastUsedAt: null,
          revokedAt: "2026-06-03T00:00:00.000Z",
          createdAt: "2026-06-03T00:00:00.000Z",
        },
      ],
    });

    const { default: DeveloperAccessRoute } = await import("~/routes/app.developer-access");
    const markup = renderToStaticMarkup(createElement(DeveloperAccessRoute));

    expect(markup).toContain("2 active keys · 1 with approved actions");
    expect(markup).toContain("Read only");
    expect(markup).toContain("Agent actions");
    expect(markup).toContain("<p>Read-only · never used</p>");
    expect(markup).toContain("<p>Approved actions · never used</p>");
    expect(markup).toContain("Revoked");
  });

  it("keeps a one-time secret hidden with reveal and copy text actions", async () => {
    await mockRouter(
      {
        canCreateApiKeys: true,
        createDisabledReason: null,
        apiKeys: [],
      },
      {
        ok: true,
        intent: "create-api-key",
        message: "API key created.",
        apiKeyPrefix: "f9_live_new",
        apiKeySecret: "f9_live_new_secret",
      },
    );

    const { default: DeveloperAccessRoute } = await import(
      "~/routes/app.developer-access"
    );
    const markup = renderToStaticMarkup(createElement(DeveloperAccessRoute));

    expect(markup).toContain("Copy the new key now");
    expect(markup).toContain('type="password"');
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('value="f9_live_new_secret"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain(">Reveal<");
    expect(markup).toContain(">Copy<");
  });
});
