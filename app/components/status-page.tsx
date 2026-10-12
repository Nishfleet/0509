import { Footer, SupportLink } from "./footer";
import { eyebrow, pageWidth } from "./landing/section";
import { MAIN_CONTENT_ID, SkipLink } from "./skip-link";
import { Wordmark } from "./wordmark";

export function StatusPage({ working, checkedAt }: { working: boolean; checkedAt: string }) {
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
          <h1 className="max-w-[24ch] font-display text-display-2 font-extrabold uppercase">Status</h1>
          <p role="status" className="mt-6 max-w-prose text-lg leading-[1.55]">
            {working
              ? "Five to Nine is working."
              : "Five to Nine is having trouble right now. We know, and we are on it."}
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
