import {
  Form,
  Link,
  useLoaderData,
} from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { Pill } from "~/components/pill";
import { WorkingHeader } from "~/components/workspace/working-header";

export const meta: MetaFunction = () => [{ title: "Competitors | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Competitors" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  // The graph module is server-only (it bundles the curated map and reads D1):
  // resolve every label server-side so the client chunk never imports it.
  const {
    brandToPeers,
    competitorGraphCategoryLabel,
    listCompetitorGraphBrands,
    listCompetitorGraphCategories,
    resolveCompetitorGraphBrand,
  } = await import("~/lib/competitor-graph.server");
  const env = getEnv(context);
  await requireWorkspaceSession(env, request);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();

  // The page has three states: a brand lookup (peers for q), a category view
  // (curated brands under one category), and the default category roll-up.
  // Every read degrades to an empty list rather than taking the page down.
  const [resolvedBrand, peers, categoryBrands, categories] = await Promise.all([
    query ? resolveCompetitorGraphBrand(env, query) : null,
    query ? brandToPeers(env, query) : Promise.resolve([]),
    !query && category ? listCompetitorGraphBrands(env, category) : Promise.resolve([]),
    query ? Promise.resolve(null) : listCompetitorGraphCategories(env),
  ]);

  return {
    query,
    resolvedBrand,
    peers: peers.map((peer) => ({
      peer: peer.peer,
      categoryId: peer.categoryId,
      categoryLabel: competitorGraphCategoryLabel(peer.categoryId),
      confidence: peer.confidence,
      lastVerifiedAt: peer.lastVerifiedAt,
    })),
    category,
    categoryLabel: category ? competitorGraphCategoryLabel(category) : null,
    categoryBrands,
    categories: categories
      ? categories.map((row) => ({
          ...row,
          label: competitorGraphCategoryLabel(row.categoryId),
        }))
      : null,
  };
}

export default function CompetitorsRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <DashboardPage>
      <section className="f9-wk-stack">
        <WorkingHeader
          context="The curated brand→peer-category map behind auto-discovery."
          title="Competitors"
        />

        <article className="f9-wk-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-wk-kick">Peer lookup</span>
              <h2>Who does this brand actually compete with?</h2>
            </div>
          </div>
          <Form className="f9-auth-form" method="get" action="/app/competitors">
            <label className="f9-field">
              <span>Brand or domain</span>
              <input
                defaultValue={data.query}
                name="q"
                placeholder="allbirds.com"
                type="text"
              />
            </label>
            <button className="f9-wk-btn-quiet" type="submit">
              Show peers
            </button>
          </Form>

          {data.query ? (
            data.peers.length > 0 ? (
              <div className="f9-wk-suggest" role="list">
                {data.peers.map((peer) => (
                  <span key={peer.peer} role="listitem">
                    <Link
                      className="f9-wk-chip"
                      to={`/search?website=${encodeURIComponent(peer.peer)}&related=1`}
                    >
                      {peer.peer}
                    </Link>{" "}
                    <Pill
                      title={`Curated category: ${peer.categoryId} · confidence ${peer.confidence}`}
                      variant="status"
                    >
                      {peer.categoryLabel}
                    </Pill>
                  </span>
                ))}
              </div>
            ) : (
              <p className="f9-wk-sec-sub">
                {data.resolvedBrand
                  ? `No curated peers mapped for ${data.resolvedBrand} yet.`
                  : `${data.query} is not in the curated competitor map yet.`}
              </p>
            )
          ) : null}
        </article>

        {data.category && !data.query ? (
          <article className="f9-wk-panel">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-wk-kick">Category</span>
                <h2>{data.categoryLabel ?? data.category}</h2>
              </div>
            </div>
            {data.categoryBrands.length > 0 ? (
              <div className="f9-wk-suggest" role="list">
                {data.categoryBrands.map((row) => (
                  <Link
                    className="f9-wk-chip"
                    key={row.brand}
                    role="listitem"
                    to={`/app/competitors?q=${encodeURIComponent(row.brand)}`}
                  >
                    {row.brand} · {row.edges}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="f9-wk-sec-sub">No curated brands under this category yet.</p>
            )}
          </article>
        ) : null}

        {!data.query && data.categories ? (
          <article className="f9-wk-panel">
            <div className="f9-panel-toolbar">
              <div>
                <span className="f9-wk-kick">Curated map</span>
                <h2>Peer categories</h2>
              </div>
            </div>
            <div className="f9-wk-suggest" role="list">
              {data.categories.map((row) => (
                <Link
                  className="f9-wk-chip"
                  key={row.categoryId}
                  role="listitem"
                  to={`/app/competitors?category=${encodeURIComponent(row.categoryId)}`}
                >
                  {row.label} · {row.brands} brands
                </Link>
              ))}
            </div>
          </article>
        ) : null}
      </section>
    </DashboardPage>
  );
}
