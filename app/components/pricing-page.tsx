import type { StartSource } from "../lib/pricing-page";
import { Footer } from "./footer";
import { Faq } from "./landing/faq";
import { Price } from "./landing/price";
import { eyebrow, pageWidth } from "./landing/section";
import { MAIN_CONTENT_ID, SkipLink } from "./skip-link";
import { Wordmark } from "./wordmark";

export function PricingPage({ source }: { source: StartSource | null }) {
  return (
    <div className="bg-bone text-ink">
      <SkipLink />
      <header className="border-b border-line">
        <div className={`${pageWidth} flex min-h-16 items-center justify-between gap-6`}>
          <Wordmark />
          <nav aria-label="Site" className={`${eyebrow} flex gap-7`}>
            <a
              className="flex min-h-11 items-center text-ink-soft transition-colors duration-140 hover:text-ink"
              href="/"
            >
              Overview
            </a>
            <a className="flex min-h-11 items-center text-ink underline decoration-1 underline-offset-4" href="/login">
              Sign in
            </a>
          </nav>
        </div>
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <div className={`${pageWidth} py-12 sm:py-16`}>
          <h1 className="max-w-[24ch] font-display text-display-2 font-extrabold uppercase">Five to Nine pricing</h1>
        </div>
        <Price source={source} />
        <p className={`${pageWidth} pb-12 font-mono text-meta text-ink-soft`}>
          Prices are in euros. At checkout you see your local currency where we can offer it.
        </p>
        <Faq />
      </main>
      <div className={`${pageWidth} pb-12`}>
        <Footer />
      </div>
    </div>
  );
}
