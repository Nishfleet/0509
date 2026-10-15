import type { StartSource } from "../lib/pricing-page";
import { Footer } from "./footer";
import { Faq } from "./landing/faq";
import { Price } from "./landing/price";
import { pageWidth } from "./landing/section";
import { SiteHeader } from "./site-header";
import { MAIN_CONTENT_ID, SkipLink } from "./skip-link";

export function PricingPage({ source }: { source: StartSource | null }) {
  return (
    <div className="bg-bone text-ink">
      <SkipLink />
      <SiteHeader />
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <Price source={source} page />
        <p className={`${pageWidth} pb-4 font-mono text-meta text-ink-soft`}>
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
