import { Footer, SupportLink } from "./footer";
import { pageWidth } from "./landing/section";
import { SiteHeader } from "./site-header";
import { MAIN_CONTENT_ID, SkipLink } from "./skip-link";

export function StatusPage({ working, checkedAt }: { working: boolean; checkedAt: string }) {
  return (
    <div className="bg-bone text-ink">
      <SkipLink />
      <SiteHeader />
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <div className={`${pageWidth} py-12 sm:py-16`}>
          <h1 className="max-w-[24ch] font-display text-display-2 font-extrabold uppercase">Status</h1>
          <p role="status" className="mt-6 max-w-prose text-lg leading-[1.55]">
            {working
              ? "The Five to Nine site and its database are working."
              : "Five to Nine is having trouble right now."}
          </p>
          <p className="mt-3 font-mono text-meta text-ink-soft">
            Checked <time dateTime={checkedAt}>{checkedAt.slice(0, 19).replace("T", " ")} UTC</time>. Reload to check
            again. Trouble that lasts? Write to <SupportLink />.
          </p>
        </div>
      </main>
      <div className={`${pageWidth} pb-12`}>
        <Footer />
      </div>
    </div>
  );
}
