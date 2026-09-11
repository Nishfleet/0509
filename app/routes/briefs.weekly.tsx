/**
 * /briefs/weekly — the public weekly brief of competitor offer moves
 * (issue #2143).
 *
 * One page listing what moved in the last 7 days across the brands that
 * already have a public, sitemap-indexable /ads/:domain or /timeline/:domain
 * page. Every row is a stored capture — a confirmed watch event or a
 * proof-gated offer-ledger transition — with its before/after text, source
 * link, and capture date. The page never triggers live scraping.
 *
 * Honesty gates are inherited from the loader (`loadWeeklyPublicMoves`),
 * which reuses the exact sitemap indexability gates the /ads/:domain and
 * /timeline/:domain pages render under: a domain that would serve a noindex
 * shell (demo, stale, empty, unverified, alias, or customer-private) never
 * appears here. When nothing moved, the page renders an honest quiet state
 * instead of a fabricated list — the same contract as the /brands hub, and
 * the page stays indexable either way (it is one static sitemap entry, not a
 * programmatic per-domain surface).
 */

import { Link, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import { LocalTime } from "~/components/local-time";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import type { WeeklyPublicMove } from "~/lib/weekly-public-moves.server";
import "../marketing.css";

interface BriefsWeeklyLoaderData {
  moves: WeeklyPublicMove[];
  /** ISO timestamp of the window start (7 days before render). */
  since: string;
}

export async function loader({ context }: LoaderFunctionArgs): Promise<BriefsWeeklyLoaderData> {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { loadWeeklyPublicMoves, WEEKLY_MOVES_WINDOW_MS } = await import(
    "~/lib/weekly-public-moves.server"
  );
  const since = new Date(Date.now() - WEEKLY_MOVES_WINDOW_MS).toISOString();

  let moves: WeeklyPublicMove[] = [];
  try {
    moves = await loadWeeklyPublicMoves(env, { since });
  } catch (error) {
    // A read hiccup degrades to the honest quiet state, never a 500.
    console.warn("Weekly brief load failed; rendering the quiet state.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    moves = [];
  }
  return { moves, since };
}

const weeklyBriefDescription =
  "The last 7 days of offer, price, CTA, and ad moves across brands with a public Five to Nine page — stored captures only, every row with its source link and capture date.";

export const links: LinksFunction = () => canonicalLinks("/briefs/weekly");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Weekly competitor offer moves | Five to Nine",
    description: weeklyBriefDescription,
    pathname: "/briefs/weekly",
  });

function moveChangeText(move: WeeklyPublicMove): string {
  if (move.beforeText && move.afterText) {
    return `${move.beforeText} → ${move.afterText}`;
  }
  return move.afterText ?? move.beforeText ?? "";
}

export default function BriefsWeeklyRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <main className="f9-home f9-briefs-weekly-page">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Weekly competitor offer moves | Five to Nine",
            description: weeklyBriefDescription,
            pathname: "/briefs/weekly",
          }),
        )}
      />
      <MarketingNav />

      <section className="ld-section" aria-labelledby="briefs-weekly-title">
        <div className="ld-section-head">
          <span className="ld-kicker">Weekly brief</span>
          <h1 id="briefs-weekly-title">What moved this week</h1>
          <p>
            The last 7 days of offer, price, CTA, and ad moves across brands with a public
            page here — stored captures only, every row with its source link and capture
            date. Brands with no public page never appear, and a quiet week says so.
          </p>
        </div>

        {data.moves.length === 0 ? (
          <p className="ld-dim">
            A quiet week on the public record — no brand with a public page changed its
            offer, price, CTA, or ads in the last 7 days. Moves appear here as scheduled
            watches capture them; browse <Link to="/brands">tracked brands</Link> or run
            the <Link to="/search">live search</Link> for a current look.
          </p>
        ) : (
          <ul className="ld-trail">
            {data.moves.map((move) => (
              <li key={`${move.domain}|${move.field}|${move.capturedAt}|${move.beforeText ?? ""}|${move.afterText ?? ""}`}>
                <strong>
                  {move.adsPath ? (
                    <Link to={move.adsPath}>{move.brand}</Link>
                  ) : (
                    move.brand
                  )}{" "}
                  — {move.field}
                </strong>
                <p>{moveChangeText(move)}</p>
                <em>
                  captured <LocalTime iso={move.capturedAt} mode="date" />
                  {move.sourceUrl ? (
                    <>
                      {" · "}
                      <a href={move.sourceUrl} target="_blank" rel="noreferrer">
                        source
                      </a>
                    </>
                  ) : null}
                  {move.adsPath ? (
                    <>
                      {" · "}
                      <Link to={move.adsPath}>ads</Link>
                    </>
                  ) : null}
                  {move.timelinePath ? (
                    <>
                      {" · "}
                      <Link to={move.timelinePath}>timeline</Link>
                    </>
                  ) : null}
                </em>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MarketingFooter />
    </main>
  );
}
