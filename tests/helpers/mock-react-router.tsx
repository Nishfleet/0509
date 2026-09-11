import { vi } from "vitest";
import type { ReactNode } from "react";

type ReactRouterMockOptions = {
  /** Value every `useRouteLoaderData` call returns. Defaults to `undefined`. */
  loaderData?: unknown;
  /** Value `useLoaderData` returns. Only overridden when provided. */
  loader?: unknown;
  /** Value `useActionData` returns. Only overridden when provided. */
  actionData?: unknown;
  /** Value `useNavigation` returns. Only overridden when provided. */
  navigation?: unknown;
  /** Value `useLocation` returns. Only overridden when provided. */
  location?: unknown;
  /** Value `useNavigate` returns. Only overridden when provided. */
  navigate?: unknown;
  /** Value `useRevalidator` returns. Only overridden when provided. */
  revalidator?: unknown;
};

/**
 * Stub `react-router` so a route component can be rendered to static markup.
 *
 * The real module stays in place; `Link` (renders `<a href>`), `Form`
 * (renders `<form>`) and `useRouteLoaderData` are always replaced; the other
 * mocked hooks (`useLoaderData`, `useActionData`, `useNavigation`,
 * `useLocation`, `useNavigate`, `useRevalidator`) are only replaced when the
 * matching option is provided. Call it inside `beforeEach` after
 * `vi.resetModules()`.
 */
export function mockReactRouter(options: ReactRouterMockOptions = {}) {
  const { loaderData, loader, actionData, navigation, location, navigate, revalidator } = options;
  const has = (key: keyof ReactRouterMockOptions) => key in options;
  // A function-valued option is late-bound: the hook calls it at render time,
  // so tests can keep a mutable fixture (`loader: () => currentData`).
  const resolve = (value: unknown) => (typeof value === "function" ? (value as () => unknown)() : value);
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useRouteLoaderData: () => resolve(loaderData),
      ...(has("loader") ? { useLoaderData: () => resolve(loader) } : {}),
      ...(has("actionData") ? { useActionData: () => resolve(actionData) } : {}),
      ...(has("navigation") ? { useNavigation: () => resolve(navigation) } : {}),
      ...(has("location") ? { useLocation: () => resolve(location) } : {}),
      ...(has("navigate") ? { useNavigate: () => resolve(navigate) } : {}),
      ...(has("revalidator") ? { useRevalidator: () => resolve(revalidator) } : {}),
    };
  });
}
