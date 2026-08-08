import { PublicDocHeader } from "~/components/public-doc-shell";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export const meta = () => [
  { title: "Five to Nine Presence Bot" },
  { name: "robots", content: "noindex" },
];

export default function PresenceBotInfoRoute() {
  return (
    <main className="f9-legal-page">
      <PublicDocHeader />
      <section className="f9-container f9-legal-section">
        <article className="f9-legal-card">
          <span className="f9-wk-kick">Crawler information</span>
          <h1>FiveToNinePresenceBot</h1>
          <p className="f9-wk-dim">
            Five to Nine uses this crawler to monitor public websites and blogs that customers explicitly
            choose to track for competitor and brand presence updates.
          </p>

          <section className="f9-legal-block">
            <h2>What it does</h2>
            <ul className="f9-doc-list">
              <li>Fetches public RSS, Atom, and XML sitemap feeds when allowed.</li>
              <li>Respectfully polls public HTML pages for meaningful content changes.</li>
              <li>Always obeys robots.txt rules for the target site.</li>
              <li>Does not access private networks, authenticated pages, or customer cookies.</li>
            </ul>
          </section>

          <section className="f9-legal-block">
            <h2>User-Agent</h2>
            <p>
              <code>FiveToNinePresenceBot/1.0 (+https://0509.io/bots/presence)</code>
            </p>
          </section>

          <section className="f9-legal-block">
            <h2>Contact and opt-out</h2>
            <p>
              To request changes, report issues, or ask us to stop crawling a public site, email{" "}
              <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
            </p>
          </section>
        </article>
      </section>
    </main>
  );
}
