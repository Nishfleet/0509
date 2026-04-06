import type { Metadata } from "next";
import Link from "next/link";

import { SearchDemo } from "@/components/search-demo";
import { WAITLIST_URL, hasExternalWaitlist } from "@/lib/config";

export const metadata: Metadata = {
  title: "Meta Ad Library search demo",
  description:
    "Explore the 0509 search workflow for competitor ad research across advertisers, keywords, platforms, and creative types.",
  openGraph: {
    title: "Meta Ad Library search demo | 0509",
    description:
      "Explore the 0509 search workflow for competitor ad research across advertisers, keywords, platforms, and creative types.",
    url: "https://0509.in/search",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Meta Ad Library search demo | 0509",
    description:
      "Explore the 0509 search workflow for competitor ad research across advertisers, keywords, platforms, and creative types.",
  },
};

const waitlistProps = hasExternalWaitlist
  ? { rel: "noreferrer", target: "_blank" as const }
  : {};

export default function SearchPage() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="container app-header-row">
          <div>
            <p className="eyebrow">0509</p>
            <h1 className="app-title">Meta Ad Library search</h1>
          </div>
          <div className="app-actions">
            <Link className="button button-secondary" href="/">
              Back home
            </Link>
            <a className="button button-primary" href={WAITLIST_URL} {...waitlistProps}>
              Join waitlist
            </a>
          </div>
        </div>
      </header>

      <SearchDemo />
    </main>
  );
}
