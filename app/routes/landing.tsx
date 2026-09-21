import type { Route } from "./+types/landing";

// support@ is the address with an explicit Cloudflare Email Routing rule.
// hello@ only reaches the inbox via the catch-all, so it is not the one to
// print on the only page the public can reach.
const CONTACT = "support@0509.io";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Five to Nine" },
    {
      name: "description",
      content:
        "Five to Nine is taking a season to become what it should have been. Back autumn 2026.",
    },
    // noindex while the public site is gated behind the redesign. This comes
    // off in the PR that removes the gate — not before, and not separately.
    { name: "robots", content: "noindex" },
  ];
}

/**
 * The public site while the rebuild is in progress.
 *
 * Quiet on purpose. The first version of this page shouted in 5rem caps with a
 * struck "old site → new site" mark; Nish read the caps as aggressive and the
 * strike as a jab at our own work. So: sentence case at weight 600, one narrow
 * column with air around it, and the copy hints rather than declares. The only
 * colour on the page is the wordmark's 09.
 *
 * Still deliberately static — no loader, no state, no client behaviour beyond
 * the framework's own hydration. The largest paint is the headline, which is
 * text, so nothing here can push LCP past its budget.
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[64rem] flex-col justify-between px-6 py-12 sm:px-12 sm:py-16">
      <header>
        <span className="font-display text-base font-bold tracking-[-0.03em]">
          05<span className="bg-accent text-on-accent px-[5px]">09</span>
        </span>
      </header>

      <div className="max-w-[34rem] py-20 sm:py-28">
        <p className="text-ink-faint flex items-center gap-2.5 font-mono text-[0.72rem] font-normal tracking-[0.14em] lowercase">
          <span
            aria-hidden="true"
            className="bg-ink-faint inline-block size-[5px] motion-safe:animate-[breathe_3.2s_ease-in-out_infinite]"
          />
          a quiet rebuild
        </p>

        <h1 className="font-display mt-7 text-[clamp(1.75rem,3.6vw,2.9rem)] leading-[1.15] font-semibold tracking-[-0.02em]">
          Something is being watched.
        </h1>

        <p className="text-ink-soft mt-7 text-[clamp(1rem,1.3vw,1.1rem)] leading-[1.65]">
          Five to Nine is taking a season to become what it should have been.
          You&rsquo;ll see where you stand when it&rsquo;s ready.
        </p>

        <p className="text-ink-faint mt-14 font-mono text-[0.74rem] tracking-[0.12em] lowercase">
          autumn 2026
        </p>
      </div>

      <footer className="border-line text-ink-faint border-t pt-7 font-mono text-[0.72rem] tracking-[0.06em]">
        <a
          className="hover:text-ink underline decoration-1 underline-offset-4 transition-colors duration-150"
          href={`mailto:${CONTACT}`}
        >
          {CONTACT}
        </a>
      </footer>
    </main>
  );
}
