import type { ReactElement } from "react";

import { type CoverageId, isLive } from "../../lib/coverage";
import { cn } from "../../lib/utils";
import { OneInput } from "../one-input";
import { ExampleMark } from "./example-mark";
import { eyebrow, pageWidth } from "./section";
import { StartWatchingLabel } from "./start-button";

const EXAMPLES: readonly {
  needs: CoverageId;
  who: string;
  where: string;
  before: string;
  after: string;
  own: boolean;
}[] = [
  {
    needs: "site.pricing",
    who: "A rival",
    where: "pricing page",
    before: "20% off annual",
    after: "30% off annual",
    own: false,
  },
  {
    needs: "ads.meta",
    who: "A rival",
    where: "3 new Meta ads",
    before: "“Built for serious teams”",
    after: "“Affordable”",
    own: false,
  },
  {
    needs: "site.home",
    who: "A rival",
    where: "homepage",
    before: "“Built for serious teams”",
    after: "“Built for everyone”",
    own: false,
  },
  { needs: "own.breakage", who: "Your site", where: "homepage", before: "Page loads", after: "Error 503", own: true },
];

const SHOWN = EXAMPLES.filter((example) => isLive(example.needs)).slice(0, 3);

type Example = (typeof EXAMPLES)[number];

function ExampleCard({ example }: { example: Example }): ReactElement {
  return (
    <li className={cn("border-[1.5px] border-ink p-5", example.own ? "bg-green-wash" : "bg-card")}>
      <p className="font-mono text-meta text-ink-soft">
        <strong className="font-medium text-ink">{example.who}</strong> · {example.where}
      </p>
      <ExampleMark before={example.before} after={example.after} className="mt-3 text-mark-md" />
      {example.own ? (
        <p className="mt-3 font-mono text-meta text-ink-soft">This one is emailed to you the moment we see it.</p>
      ) : null}
    </li>
  );
}

function HeroProof(): ReactElement {
  return (
    <aside aria-labelledby="hero-proof" className="min-w-0">
      <p id="hero-proof" className={`${eyebrow} text-green-ink`}>
        How a change reads
      </p>
      <p className="mt-2 font-mono text-meta text-ink-soft">Worked examples, not live marks.</p>
      <ul className="mt-4 grid gap-3">
        {SHOWN.map((example) => (
          <ExampleCard key={example.needs} example={example} />
        ))}
      </ul>
    </aside>
  );
}

export function Hero({ nouns }: { nouns: string }) {
  return (
    <section id="hero" aria-labelledby="hero-title">
      <div
        className={`${pageWidth} grid gap-12 py-14 min-[1080px]:grid-cols-[1.15fr_0.85fr] min-[1080px]:items-center min-[1080px]:gap-16 sm:py-20`}
      >
        <div className="min-w-0">
          <p className={`${eyebrow} text-ink-soft`}>For founders, brands and creators</p>
          <h1 id="hero-title" className="mt-5 font-display text-display-1 font-extrabold uppercase">
            Know where you stand. And who’s gaining on you.
          </h1>
          <p className="mt-6 max-w-[38rem] text-[clamp(1.05rem,1.4vw,1.2rem)] leading-[1.55] text-ink-soft">
            We watch {nouns} across your market, and we name the rivals for you, so you do not have to know them.
          </p>
          <div className="max-w-[38rem]">
            <OneInput
              label="your website, or a handle"
              placeholder="your website, or a handle"
              name="subject"
              action="/login"
              method="get"
              required
              maxLength={200}
              submitLabel={<StartWatchingLabel />}
            />
          </div>
          <p className="mt-4 max-w-[38rem] font-mono text-meta text-ink-soft">
            One input. Sixty seconds to who’s gaining on you.
          </p>
        </div>
        <HeroProof />
      </div>
    </section>
  );
}
