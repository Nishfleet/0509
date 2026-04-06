import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="not-found-page">
      <div className="container not-found-container">
        <p className="eyebrow">404</p>
        <h1>Page not found.</h1>
        <p className="not-found-desc">
          This page doesn&apos;t exist — or it moved. Either way, you&apos;re
          not missing much.
        </p>
        <div className="not-found-actions">
          <Link className="button button-primary" href="/">
            Back to home
          </Link>
          <Link className="button button-secondary" href="/search">
            Try the demo
          </Link>
        </div>
      </div>
    </main>
  );
}
