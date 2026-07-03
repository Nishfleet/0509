import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

async function mockRouter(loaderData: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(undefined),
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
      apiKeys: [],
    });

    const { default: DeveloperAccessRoute } = await import("~/routes/app.developer-access");
    const markup = renderToStaticMarkup(createElement(DeveloperAccessRoute));

    expect(markup).toMatch(/Active keys[\s\S]*?<strong>0<\/strong>/);
    expect(markup).toContain("Needs write key");
    expect(markup).toContain("Allow approved account actions");
    expect(markup).toContain("API documentation");
  });

  it("counts active keys and write-enabled keys separately", async () => {
    await mockRouter({
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

    expect(markup).toMatch(/Active keys[\s\S]*?<strong>2<\/strong>/);
    expect(markup).toContain("1 enabled");
    expect(markup).not.toContain("Needs write key");
  });
});
