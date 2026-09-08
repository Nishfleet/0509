import type { ReactNode } from "react";

/**
 * Citations for `/compare/*` pages.
 *
 * The brand hero promises "every claim has a link". The `/switch/*` route
 * honors it with an inline source link per claim and a "Sources" footer; the
 * `/compare/*` route historically did not. Each compare page now ships a
 * `app/data/compare/<competitor>-citations.json` file that lists every
 * first-party competitor source URL with the claim it backs, and renders both
 * the inline source links and the "Every claim on this page has a link"
 * footer from that single file.
 *
 * A "first-party competitor source" is the competitor's own site (pricing
 * page, blog, docs, product page) or, for `/compare/meta-ad-library`, Meta's
 * own Ad Library. Third-party review sites are not used as the primary
 * citation here.
 */

export interface CompareCitationSource {
  /** Stable id referenced by inline `<Cite>` calls in the route. */
  id: string;
  /** First-party competitor source URL. */
  href: string;
  /** Short human label, shown as the link text. */
  label: string;
  /** ISO date the URL was last checked live. */
  checked: string;
  /** The claim on the page that this source backs. */
  claim: string;
}

export interface CompareCitations {
  competitor: string;
  productName: string;
  sources: readonly CompareCitationSource[];
}

/**
 * A strengths/costs card on a compare page. `sourceId` is optional: only the
 * cards that make a factual competitor claim backed by a first-party source
 * carry one, and the render appends an inline `Cite` when it is present.
 */
export interface CompareClaimCard {
  title: string;
  detail: string;
  sourceId?: string;
}

/**
 * Inline source link, mirroring the `/switch/*` "Source: <a>label</a>" pattern.
 * Renders nothing when the id is not found, so a missing citation is a visible
 * gap in the footer rather than a thrown render.
 */
export function Cite({ citations, id }: { citations: CompareCitations; id: string }): ReactNode {
  const source = citations.sources.find((candidate) => candidate.id === id);
  if (!source) return null;
  return (
    <>
      {" Source: "}
      <a href={source.href} rel="noreferrer" target="_blank">
        {source.label}
      </a>
    </>
  );
}

/**
 * "Every claim on this page has a link" footer, matching the `/switch/*`
 * `SwitchClose` sources section. Renders the citations list from the JSON
 * file so the citation set is human-reviewable on the rendered page.
 */
export function CompareCitationsFooter({ citations }: { citations: CompareCitations }) {
  return (
    <section className="ld-quiet">
      <div className="ld-section-head">
        <span className="ld-kicker">Sources</span>
        <h2>Every claim on this page has a link.</h2>
      </div>
      <ul>
        {citations.sources.map((source) => (
          <li key={source.href}>
            <a href={source.href} rel="noreferrer" target="_blank">
              {source.label}
            </a>
            {" — "}
            {source.claim}
          </li>
        ))}
      </ul>
    </section>
  );
}
