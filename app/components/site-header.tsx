import { eyebrow, pageWidth } from "./landing/section";
import { Wordmark } from "./wordmark";

export function SiteHeader() {
  return (
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
  );
}
