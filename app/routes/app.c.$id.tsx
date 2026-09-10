import type { LoaderFunctionArgs, MetaFunction } from "react-router";

/**
 * `/app/c/:id` — the Competitor screen (route diet phase 1, #2213).
 *
 * The 8-screen model gives the competitor drill-in its own URL shape
 * (`/app/c/:id`) instead of the old `?watchlist=<id>` query on the board.
 * Phase 1 does NOT rewrite the competitor data path or the detail UI: this
 * route reuses the board's own loader and screen verbatim — the loader gets
 * the same request with `?watchlist=<id>` filled in, so the whole detail
 * bundle (evidence, source status card from the seam, pinned items,
 * share/export actions and their existing intents) is unchanged. Phase 2
 * (#2217) is where the detail moves off the board module for good.
 *
 * An id that does not resolve to a competitor in this workspace is a 404 —
 * never a silent fallback to the board, which would make a bad link look
 * like a working one.
 */
export {
  /** The competitor detail screen, unchanged — same component the board renders. */
  default,
  ErrorBoundary,
  HydrateFallback,
} from "./app.watchlists";
export {
  /** Every existing detail intent (pause, resume, share, export, ...) still posts here. */
  action,
} from "./app.watchlists";

export const meta: MetaFunction = () => [{ title: "Competitor | Five to Nine" }];

/** A GET-only re-issue of the caller's request with the competitor pinned. */
function withCompetitorQuery(request: Request, competitorId: string): Request {
  const url = new URL(request.url);
  if (!url.searchParams.get("watchlist")) {
    url.searchParams.set("watchlist", competitorId);
  }
  return new Request(url.toString(), {
    method: "GET",
    headers: request.headers,
  });
}

export async function loader(args: LoaderFunctionArgs) {
  const competitorId = (args.params.id ?? "").trim();
  if (!competitorId) {
    throw new Response("Not found", { status: 404 });
  }

  const { loader: loadBoard } = await import("./app.watchlists");
  const data = await loadBoard({
    ...args,
    request: withCompetitorQuery(args.request, competitorId),
  });

  if (!data.selectedWatchlist) {
    throw new Response("Not found", { status: 404 });
  }

  return data;
}
