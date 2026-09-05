import { Link } from "react-router";

import { breadcrumbJsonLd, jsonLdScriptProps } from "~/lib/seo";

/**
 * A crumb in a visible breadcrumb trail. `name` is what the visitor sees and
 * what schema.org gets; `pathname` is the canonical URL the crumb links to
 * (the same canonical the page itself links, so the crumb can never point at
 * a stray host or query-parameter variant).
 */
export interface BreadcrumbCrumb {
  name: string;
  pathname: string;
}

/**
 * Visible breadcrumb navigation + matching BreadcrumbList JSON-LD (issue
 * #1463). Renders both from one `items` array so the markup and the
 * structured data can never drift: the visible trail and Google's rich-result
 * crumb describe the same Home → Category → Page hierarchy.
 *
 * The last crumb (the current page) is rendered as plain text, not a link,
 * and is still emitted as the final BreadcrumbList position (its own canonical
 * URL), which the rich-results validator accepts as the current position.
 */
export function Breadcrumbs({ items }: { items: ReadonlyArray<BreadcrumbCrumb> }) {
  if (items.length < 2) {
    return null;
  }

  return (
    <>
      <script {...jsonLdScriptProps(breadcrumbJsonLd({ items }))} />
      <nav aria-label="Breadcrumb" className="f9-breadcrumbs">
        <ol>
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={item.pathname}>
                {isLast ? (
                  <span aria-current="page">{item.name}</span>
                ) : (
                  <Link to={item.pathname}>{item.name}</Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
