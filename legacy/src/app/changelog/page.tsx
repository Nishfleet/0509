import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Changelog — 0509",
  description: "What's new in 0509. Product updates, improvements, and fixes.",
};

type BadgeVariant = "new" | "improved" | "fixed" | "coming-soon";

interface ChangeEntry {
  date: string;
  version?: string;
  badge: BadgeVariant;
  title: string;
  description: string;
  items?: string[];
}

const CHANGELOG: ChangeEntry[] = [
  {
    date: "March 2026",
    version: "0.4",
    badge: "new",
    title: "Mobile-first responsive redesign",
    description:
      "The entire site now works beautifully on phones. Hamburger nav, collapsing hero, and tightened layouts at every breakpoint.",
    items: [
      "Slide-down mobile nav drawer with Escape + backdrop close",
      "Hero preview hidden on small screens to preserve hierarchy",
      "Section padding and font sizes tuned for 375–480 px viewports",
    ],
  },
  {
    date: "March 2026",
    badge: "new",
    title: "Scroll animations",
    description:
      "Sections and cards now fade in as you scroll down the page, making the site feel alive without being distracting.",
    items: [
      "IntersectionObserver-based — no layout jank",
      "Respects prefers-reduced-motion for accessibility",
      "Four animation variants: fade-up, fade-in, fade-left, fade-right",
    ],
  },
  {
    date: "February 2026",
    version: "0.3",
    badge: "improved",
    title: "Pricing section overhaul",
    description:
      "Cleaner three-tier layout with highlighted recommended plan, annual/monthly toggle, and feature comparison pills.",
  },
  {
    date: "February 2026",
    badge: "improved",
    title: "Ad card redesign",
    description:
      "Search results are now easier to scan. Creative thumbnails are larger, metadata is grouped into chips, and the save-to-bookmarks action is right on the card.",
  },
  {
    date: "February 2026",
    badge: "fixed",
    title: "Demo search flicker on first load",
    description:
      "The search results panel no longer flashes empty before populating when the page loads with a pre-filled query.",
  },
  {
    date: "January 2026",
    version: "0.2",
    badge: "new",
    title: "Bookmarks dashboard",
    description:
      "Save ads directly from search results and revisit them any time in your personal Bookmarks board. Persisted in your account.",
  },
  {
    date: "January 2026",
    badge: "new",
    title: "Keyword search mode",
    description:
      "Search across ad copy by keyword in addition to searching by advertiser name. Great for spotting trending angles across competitors.",
  },
  {
    date: "December 2025",
    version: "0.1",
    badge: "new",
    title: "Initial launch — waitlist + live demo",
    description:
      "0509 opens to early-access users. Core features: advertiser search, ad library browsing, platform and format filters.",
    items: [
      "Search by advertiser name",
      "Filter by platform (Meta, Instagram, Audience Network)",
      "Filter by ad format (image, video, carousel)",
      "Interactive demo with 30+ sample ads",
    ],
  },
  {
    date: "Q2 2026",
    badge: "coming-soon",
    title: "CSV + Notion export",
    description:
      "Export your saved ads and research notes directly to a spreadsheet or Notion database. No more copy-pasting.",
  },
  {
    date: "Q2 2026",
    badge: "coming-soon",
    title: "Alerts — new ads from watched brands",
    description:
      "Set up a watch list and get notified by email when a competitor runs a new ad creative.",
  },
];

const BADGE_LABELS: Record<BadgeVariant, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
  "coming-soon": "Coming soon",
};

export default function ChangelogPage() {
  return (
    <main className="legal-shell">
      <div className="container legal-container">
        <nav className="legal-breadcrumb">
          <Link href="/">0509</Link>
          <span aria-hidden="true">/</span>
          <span>Changelog</span>
        </nav>

        <header className="legal-header">
          <p className="eyebrow">What&apos;s new</p>
          <h1>Changelog</h1>
          <p className="legal-meta">
            Product updates, improvements, and what&apos;s coming next.
          </p>
        </header>

        <ol className="changelog-list" aria-label="Product updates">
          {CHANGELOG.map((entry, i) => (
            <li key={i} className="changelog-entry">
              <div className="changelog-rail">
                <span className="changelog-dot" aria-hidden="true" />
              </div>
              <div className="changelog-content">
                <div className="changelog-meta">
                  <time className="changelog-date">{entry.date}</time>
                  {entry.version && (
                    <span className="changelog-version">v{entry.version}</span>
                  )}
                  <span
                    className={`changelog-badge changelog-badge--${entry.badge}`}
                  >
                    {BADGE_LABELS[entry.badge]}
                  </span>
                </div>
                <h2 className="changelog-title">{entry.title}</h2>
                <p className="changelog-desc">{entry.description}</p>
                {entry.items && entry.items.length > 0 && (
                  <ul className="changelog-items">
                    {entry.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>

        <footer className="legal-footer">
          <Link href="/">Back to homepage</Link>
          <Link href="/search">Open demo</Link>
        </footer>
      </div>
    </main>
  );
}
