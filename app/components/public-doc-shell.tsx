import type { ReactNode } from "react";
import { Link } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export function PublicDocShell(props: {
  kicker: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="f9-legal-page">
      <PublicDocHeader />
      <section className="f9-container f9-legal-section">
        <article className="f9-legal-card">
          <span className="f9-app-kicker">{props.kicker}</span>
          <h1>{props.title}</h1>
          <p>{props.intro}</p>
          {props.children}
        </article>
      </section>
      <PublicDocFooter />
    </main>
  );
}

export function PublicDocBlock(props: { title: string; children: ReactNode }) {
  return (
    <section className="f9-legal-block">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

export function PublicDocHeader() {
  return (
    <header className="f9-legal-nav">
      <div className="f9-container f9-legal-nav-inner">
        <Link className="f9-app-brand" to="/">
          <BrandWordmark meta="Competitor change monitoring" />
        </Link>
        <nav className="f9-search-nav-links" aria-label="Public navigation">
          <Link to="/help">Help</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/status">Status</Link>
          <Link to="/auth/signup">Start</Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicDocFooter() {
  return (
    <footer className="f9-container f9-doc-footer">
      <nav aria-label="Public footer">
        <Link to="/help">Help</Link>
        <Link to="/docs">Docs</Link>
        <Link to="/api/docs">API docs</Link>
        <Link to="/status">Status</Link>
        <Link to="/changelog">Changelog</Link>
        <Link to="/trust">Trust</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
      </nav>
    </footer>
  );
}
