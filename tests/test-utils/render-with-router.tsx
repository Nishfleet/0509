import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

/**
 * Render any public-page fragment or route through a REAL react-router data
 * router (createMemoryRouter + RouterProvider) and return its static markup.
 *
 * This is the guardrail against the `useRouteLoaderData must be used within
 * a data router` invariant that red-failed PR #742: components like
 * MarketingNav read root loader data via `useRouteLoaderData("root")`, so any
 * test rendering a public surface must do it inside a data router. Rendering
 * here exercises the real router hooks — no react-router mock — so the moment
 * a component renders outside router context (or a new public-page test
 * forgets the wrapper), this helper throws instead of shipping a red CI run.
 *
 * - `rootData` is what `useRouteLoaderData("root")` returns (e.g. the session
 *   stub for auth-aware links).
 * - `routeData` is what `useLoaderData()` returns inside the rendered route
 *   element (the route's own loader payload fixture).
 */
export async function renderWithRouter(
	element: ReactElement,
	{ rootData, routeData }: { rootData?: unknown; routeData?: unknown } = {},
): Promise<string> {
	const router = createMemoryRouter([
		{
			id: "root",
			path: "/",
			loader: () => rootData ?? null,
			HydrateFallback: () => null,
			children: [
				{ index: true, loader: () => routeData ?? null, element },
			],
		},
	]);

	// Loaders resolve asynchronously even when synchronous; wait for the
	// initial navigation so renderToStaticMarkup sees the loaded tree instead
	// of the hydration fallback.
	if (!router.state.initialized) {
		await new Promise<void>((resolve) => {
			const unsubscribe = router.subscribe(() => {
				if (router.state.initialized) {
					unsubscribe();
					resolve();
				}
			});
		});
	}

	return renderToStaticMarkup(createElement(RouterProvider, { router }));
}
