import type { Route } from "./+types/landing";

const CONTACT = "hello@0509.io";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Five to Nine — redesign in progress" },
    {
      name: "description",
      content:
        "Five to Nine is being rebuilt from the ground up. Watching you and your competition across the internet, properly this time. Back autumn 2026.",
    },
    { name: "robots", content: "noindex" },
  ];
}

/**
 * The public site while the rebuild is in progress.
 *
 * Deliberately static: no loader, no state, no client behaviour beyond the
 * framework's own hydration. The largest paint is the headline, which is text,
 * so nothing on this page can push LCP past its budget — there is no image, no
 * chart, no capture and no font that blocks the first paint (`display=swap`).
 *
 * The only ornament is the mark, because the mark is the product's whole
 * vocabulary: the old value struck in red, the new one on the green marker
 * (DESIGN.md §1 rule 6).
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[72rem] flex-col justify-between px-5 py-10 sm:px-10 sm:py-14">
      <header>
        <span className="font-display text-lg font-extrabold tracking-[-0.03em] uppercase">
          05<span className="bg-accent text-on-accent px-[5px]">09</span>
        </span>
      </header>

      <div className="py-12 sm:py-16">
        <p className="font-mono text-ink-soft text-[0.72rem] font-medium tracking-[0.16em] uppercase">
          Redesign in progress
        </p>

        <h1 className="font-display mt-4 max-w-[16ch] text-[clamp(2.35rem,8vw,5rem)] leading-[1.02] font-extrabold tracking-[-0.045em] uppercase">
          Know where you stand. Back soon.
        </h1>

        <p className="text-ink-soft mt-6 max-w-[46ch] text-[clamp(1rem,1.5vw,1.18rem)] leading-[1.5]">
          Five to Nine is being rebuilt from the ground up. Watching you and your
          competition across the internet, properly this time.
        </p>

        <p
          className="font-display mt-10 flex flex-wrap items-baseline gap-x-[0.3em] gap-y-2 text-[clamp(1.25rem,3vw,2rem)] leading-[1.1] font-extrabold tracking-[-0.02em]"
          aria-label="Old site becomes new site"
        >
          <s className="text-ink-soft decoration-strike [text-decoration-thickness:0.09em]">
            old site
          </s>
          <span aria-hidden="true" className="text-ink-faint font-semibold">
            &rarr;
          </span>
          <ins className="bg-accent text-on-accent px-[0.14em] no-underline [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
            new site
          </ins>
        </p>

        <p className="text-ink-soft mt-10 font-mono text-[0.78rem] tracking-[0.1em] uppercase">
          Autumn 2026
        </p>
      </div>

      <footer className="border-line text-ink-soft border-t pt-6 font-mono text-[0.72rem] tracking-[0.06em]">
        <a
          className="text-ink underline decoration-1 underline-offset-4"
          href={`mailto:${CONTACT}`}
        >
          {CONTACT}
        </a>
      </footer>
    </main>
  );
}
