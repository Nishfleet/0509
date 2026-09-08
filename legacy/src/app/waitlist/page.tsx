import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Early access",
  description:
    "Join the early list for 0509 and explore the live search demo while access opens.",
  robots: {
    follow: true,
    index: false,
  },
};

export default function WaitlistPage() {
  return (
    <main className="fallback-shell">
      <div className="fallback-card">
        <p className="eyebrow">Waitlist</p>
        <h1>Early access is opening soon.</h1>
        <p>
          The public waitlist is opening soon. The search demo is already open
          if you want to get a feel for the product in the meantime.
        </p>
        <div className="cta-row">
          <Link className="button button-primary" href="/">
            Back to homepage
          </Link>
          <Link className="button button-secondary" href="/search">
            Open the demo
          </Link>
        </div>
      </div>
    </main>
  );
}
