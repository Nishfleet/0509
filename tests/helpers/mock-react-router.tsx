import { vi } from "vitest";
import type { ReactNode } from "react";

type ReactRouterMockOptions = {
  /** Value every `useRouteLoaderData` call returns. Defaults to `undefined`. */
  loaderData?: unknown;
};

/**
 * Stub `react-router` so a route component can be rendered to static markup.
 *
 * The real module stays in place; only `Link` (renders `<a href>`), `Form`
 * (renders `<form>`) and `useRouteLoaderData` are replaced. Call it inside
 * `beforeEach` after `vi.resetModules()`.
 */
export function mockReactRouter({ loaderData }: ReactRouterMockOptions = {}) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useRouteLoaderData: () => loaderData,
    };
  });
}
