

import { ErrorPageRecovery } from "~/components/error-page-recovery";
import {
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_TITLE,
  publicSeoMeta,
} from "~/lib/seo";

// Issue #3617: the page ships the full share-meta block, not just a title.
// It is the landing surface for every rotated-away brand URL (#3496), so a
// link previewed in a chat, a bio, or an AI answer has to render like the
// marketing pages instead of the bare `<title>Five to Nine</title>` it used
// to. There is no dynamic data here, so `publicSeoMeta`'s static fallbacks
// (og-image.png, site name, site origin) are the whole input; only the title
// and description are page-specific. `pathname` is the canonical site root
// rather than the requested path, so the canonical/og:url never advertise a
// URL that does not exist.
export const meta = () =>
  publicSeoMeta({
    title: NOT_FOUND_TITLE,
    description: NOT_FOUND_DESCRIPTION,
    pathname: "/",
  });

export function loader() {
  return new Response(null, { status: 404 });
}

export default function NotFoundPage() {
  return (
    <main className="f9-error-page">
      <div className="f9-container f9-error-layout">
        <section className="f9-error-card">
          <span className="f9-wk-kick">Five to Nine</span>
          <h1>Page not found</h1>
          <p>The page you asked for does not exist.</p>
          <ErrorPageRecovery kind="notFound" />
        </section>
      </div>
    </main>
  );
}
