import type { ReactElement } from "react";

import { type CoverageId, isLive } from "../../lib/coverage";
import { type LandingSample, isStaleLandingSample } from "../../lib/landing-sample";
import { cn } from "../../lib/utils";
import { ExampleMark } from "../landing/example-mark";
import { eyebrow } from "../landing/section";

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
    who: "A competitor",
    where: "pricing page",
    before: "20% off annual",
    after: "30% off annual",
    own: false,
  },
  {
    needs: "ads.meta",
    who: "A competitor",
    where: "3 new Meta ads",
    before: "“Built for serious teams”",
    after: "“Affordable”",
    own: false,
  },
  {
    needs: "site.home",
    who: "A competitor",
    where: "homepage",
    before: "“Built for serious teams”",
    after: "“Built for everyone”",
    own: false,
  },
  {
    needs: "own.breakage",
    who: "Your site",
    where: "homepage",
    before: "Page loads",
    after: "Page is down",
    own: true,
  },
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

export function LandingSampleFallback(): ReactElement {
  return (
    <aside aria-labelledby="hero-proof" className="min-w-0" data-landing-sample="fallback">
      <p id="hero-proof" className={`${eyebrow} text-green-ink`}>
        What a change looks like
      </p>
      <p className="mt-2 font-mono text-meta text-ink-soft">Examples, not real changes.</p>
      <ul className="mt-4 grid gap-3">
        {SHOWN.map((example) => (
          <ExampleCard key={example.needs} example={example} />
        ))}
      </ul>
    </aside>
  );
}

export function LandingSampleCard({ sample, now }: { sample: LandingSample | null; now: number }): ReactElement {
  if (!sample || isStaleLandingSample(sample.weekStartAt, now)) return <LandingSampleFallback />;
  return (
    <aside aria-labelledby="hero-proof" className="min-w-0" data-landing-sample="live">
      <p id="hero-proof" className={`${eyebrow} text-green-ink`}>
        Live card
      </p>
      <div className="mt-3" dangerouslySetInnerHTML={{ __html: sample.html }} />
    </aside>
  );
}
