import type { Route } from "./+types/landing";

const CONTACT = "support@0509.io";

export const links: Route.LinksFunction = () => [
  {
    rel: "preload",
    href: "/fonts/bricolage-grotesque-latin.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
];

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Five to Nine" },
    {
      name: "description",
      content:
        "Quietly, we're rebuilding. You'll see where you stand when it's ready.",
    },
    { name: "robots", content: "noindex" },
  ];
}

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
