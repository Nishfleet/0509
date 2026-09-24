import { type CoverageId, isLive, WATCHED_NOUNS } from "../../lib/coverage";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { ExampleMark } from "./example-mark";
import { eyebrow, pageWidth } from "./section";
import { startButtonClass, StartWatchingLabel } from "./start-button";

const EXAMPLES: readonly {
  needs: CoverageId;
  who: string;
  where: string;
  before: string;
  after: string;
  own: boolean;
}[] = [
  { needs: "site.pricing", who: "A rival", where: "pricing page", before: "20% off annual", after: "30% off annual", own: false },
  { needs: "ads.meta", who: "A rival", where: "3 new Meta ads", before: "“Built for serious teams”", after: "“Affordable”", own: false },
  { needs: "site.home", who: "A rival", where: "homepage", before: "“Built for serious teams”", after: "“Built for everyone”", own: false },
  { needs: "own.breakage", who: "Your site", where: "homepage", before: "Page loads", after: "Error 503", own: true },
];

const SHOWN = EXAMPLES.filter((example) => isLive(example.needs)).slice(0, 3);

export function Hero() {
  return (
    <section id="hero" aria-labelledby="hero-title">
      <div
        className={`${pageWidth} grid gap-12 py-14 sm:py-20 min-[1080px]:grid-cols-[1.15fr_0.85fr] min-[1080px]:items-center min-[1080px]:gap-16`}
      >
        <div className="min-w-0">
          <p className={`${eyebrow} text-ink-soft`}>For founders, brands and creators</p>
          <h1 id="hero-title" className="font-display text-display-1 mt-5 font-extrabold uppercase">
            Know where you stand. And who’s gaining on you.
          </h1>
          <p className="text-ink-soft mt-6 max-w-[38rem] text-[clamp(1.05rem,1.4vw,1.2rem)] leading-[1.55]">
            We watch {WATCHED_NOUNS} across your market, and we name the rivals for you, so you do not have to know
            them.
          </p>
          <form method="get" action="/login" className="mt-9 max-w-[38rem]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <Input
                name="subject"
                placeholder="your website, or a handle"
                aria-label="your website, or a handle"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                required
                maxLength={200}
                className="sm:min-w-0 sm:flex-1"
              />
              <button type="submit" className={`${startButtonClass} shrink-0`}>
                <StartWatchingLabel />
              </button>
            </div>
          </form>
          <p className="font-mono text-meta text-ink-soft mt-4 max-w-[38rem]">
            One input. Sixty seconds to your first standing.
          </p>
        </div>
        <aside aria-labelledby="hero-proof" className="min-w-0">
          <p id="hero-proof" className={`${eyebrow} text-green-ink`}>
            How a change reads
          </p>
          <ul className="mt-4 grid gap-3">
            {SHOWN.map((example) => (
              <li
                key={example.needs}
                className={cn("border-ink border-[1.5px] p-5", example.own ? "bg-green-wash" : "bg-card")}
              >
                <p className="font-mono text-meta text-ink-soft">
                  <strong className="text-ink font-medium">{example.who}</strong> · {example.where}
                </p>
                <ExampleMark before={example.before} after={example.after} className="text-mark-md mt-3" />
                {example.own ? (
                  <p className="font-mono text-meta text-ink-soft mt-3">This one is emailed to you the moment we see it.</p>
                ) : null}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
