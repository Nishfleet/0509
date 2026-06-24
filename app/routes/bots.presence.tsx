export const meta = () => [
  { title: "Five to Nine Presence Bot" },
  { name: "robots", content: "noindex" },
];

export default function PresenceBotInfoRoute() {
  return (
    <main className="f9-page f9-page-narrow">
      <header className="f9-page-header">
        <p className="f9-eyebrow">Crawler information</p>
        <h1>FiveToNinePresenceBot</h1>
        <p className="f9-page-lead">
          Five to Nine uses this crawler to monitor public websites and blogs that customers explicitly
          choose to track for competitor and brand presence updates.
        </p>
      </header>

      <article className="f9-card f9-stack">
        <section>
          <h2>What it does</h2>
          <ul>
            <li>Fetches public RSS, Atom, and XML sitemap feeds when allowed.</li>
            <li>Respectfully polls public HTML pages for meaningful content changes.</li>
            <li>Always obeys robots.txt rules for the target site.</li>
            <li>Does not access private networks, authenticated pages, or customer cookies.</li>
          </ul>
        </section>

        <section>
          <h2>User-Agent</h2>
          <p>
            <code>FiveToNinePresenceBot/1.0 (+https://0509.io/bots/presence)</code>
          </p>
        </section>

        <section>
          <h2>Contact and opt-out</h2>
          <p>
            To request changes, report issues, or ask us to stop crawling a public site, email{" "}
            <a href="mailto:support@0509.in">support@0509.in</a>.
          </p>
        </section>
      </article>
    </main>
  );
}
