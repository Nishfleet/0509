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
        "Quietly, we're rebuilding. You'll see where you stand when it's ready.",
    },
    // noindex while the public site is gated behind the redesign. This comes
    // off in the PR that removes the gate — not before, and not separately.
    { name: "robots", content: "noindex" },
  ];
}

/**
 * The public site while the rebuild is in progress.
 *
 * Four things, and nothing else: the wordmark, the headline, one sentence, the
 * address. Earlier versions carried a shouted caps headline, a struck
 * "old site → new site" mark, a mono eyebrow, a breathing dot and a date; Nish
 * cut all of it. What is left is quiet on purpose, and the only colour on the
 * page is the wordmark's 09.
 *
 * No date on purpose too: a date on a coming-soon page is a promise that ages
 * badly in public, and this one would have gone stale without anyone noticing.
 *
 * Deliberately static — no loader, no state, no client behaviour beyond the
 * framework's own hydration, and no animation at all.
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
        <h1 className="font-display text-[clamp(1.75rem,3.6vw,2.9rem)] leading-[1.15] font-semibold tracking-[-0.02em]">
          Quietly, we&rsquo;re rebuilding.
        </h1>

        <p className="text-ink-soft mt-7 text-[clamp(1rem,1.3vw,1.1rem)] leading-[1.65]">
          You&rsquo;ll see where you stand when it&rsquo;s ready.
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
