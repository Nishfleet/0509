import type { ReactNode } from "react";
import { Link } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
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
          <span className="f9-wk-kick">{props.kicker}</span>
          <h1>{props.title}</h1>
          <p>{props.intro}</p>
          {props.children}
        </article>
      </section>
      <PublicDocFooter />
    </main>
  );
}

export function PublicDocBlock(props: {
  title: string;
  children: ReactNode;
  /** Optional stable anchor id so an in-page TOC can jump to this block. */
  id?: string;
}) {
  return (
    <section className="f9-legal-block" id={props.id}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

export function PublicDocHeader() {
  // The doc/legal shell shares the one public header so every public surface
  // shows the same canonical link list and the same bone case-file chrome.
  // Switch-page links are surfaced in the footer on these pages so the header
  // stays focused on navigation, not competitor mentions (issue #1466).
  return <MarketingNav showSwitchLinks={false} />;
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
        <Link to="/capture-rules">Proof rules</Link>
        <Link to="/trust">Trust</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
      </nav>
    </footer>
  );
}
