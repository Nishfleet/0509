/**
 * /sample-brief — the public "real Monday brief" page (issue #2136).
 *
 * Renders a genuine stored digest for the newest sitemap-indexable brand that
 * has at least one confirmed watch_event in the last 30 days, built through
 * the existing digest builder from stored rows only. When no brand qualifies,
 * the page renders the honest quiet-brief variant. The page never fabricates
 * a brief, never triggers live scraping, and never exposes a customer
 * workspace name, email, watchlist id, or non-indexable domain.
 */

import { Link, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import type { SampleBriefData } from "~/lib/sample-brief.server";

import "~/styles/marketing.css";
export async function loader({ context }: LoaderFunctionArgs): Promise<SampleBriefData> {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { loadSampleBrief } = await import("~/lib/sample-brief.server");
  return loadSampleBrief(env);
}

const sampleBriefDescription =
  "A real Monday brief: the last 30 days of stored competitor offer, price, CTA, and ad moves for a public brand — stored captures only, every row with its source link and capture date.";

export const links: LinksFunction = () => canonicalLinks("/sample-brief");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "A real Monday brief | Five to Nine",
    description: sampleBriefDescription,
    pathname: "/sample-brief",
  });

export default function SampleBriefRoute() {
  const data = useLoaderData<typeof loader>();

  const heading = data.quiet
    ? "A real Monday brief"
    : `A real Monday brief for ${data.brand}`;
  const signupHref = data.domain
    ? `/auth/signup?competitor=${encodeURIComponent(data.domain)}&source=sample_brief`
    : "/auth/signup?source=sample_brief";

  return (
    <main className="f9-home f9-sample-brief-page">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "A real Monday brief | Five to Nine",
            description: sampleBriefDescription,
            pathname: "/sample-brief",
          }),
        )}
      />
      <MarketingNav />

      <section className="ld-section" aria-labelledby="sample-brief-title">
        <div className="ld-section-head">
          <span className="ld-kicker">Sample brief</span>
          <h1 id="sample-brief-title">{heading}</h1>
          <p>
            This is a real brief built from stored captures — the same digest
            our customers get every Monday, shown here for a public brand.
            Every row is a stored change with its source link and capture date.
            No live scraping, no fabricated moves.
          </p>
        </div>

        <div
          className="sample-brief-digest"
          // The digest HTML is built by the existing digest builder from
          // stored rows only; it is server-rendered and never user-supplied.
          dangerouslySetInnerHTML={{ __html: data.digestHtml }}
        />

        <div className="ld-section-head sample-brief-cta">
          <h2>Get this every Monday, free</h2>
          <p>
            Track {data.brand || "your competitors"} and get a real brief like
            this in your inbox each week — no credit card required.
          </p>
          <Link className="ld-cta-button" to={signupHref}>
            Get this every Monday, free
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
