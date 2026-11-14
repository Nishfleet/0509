import type { ReactElement } from "react";

import { OneInput } from "../one-input";
import { eyebrow, pageWidth } from "./section";
import { StartWatchingLabel } from "./start-button";

export function Hero({ nouns, proof }: { nouns: string; proof: ReactElement }): ReactElement {
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
            We watch {nouns} across your market. We find your competitors for you, so you don't need to know who they
            are.
          </p>
          <div className="max-w-[38rem]">
            <OneInput
              label="Your website address or social username"
              placeholder="yoursite.com or @yourbrand"
              name="subject"
              action="/login"
              method="get"
              required
              maxLength={200}
              submitLabel={<StartWatchingLabel />}
              pendingLabel="Starting…"
            />
          </div>
          <p className="mt-4 max-w-[38rem] font-mono text-meta text-ink-soft">
            One box to fill in. About a minute to see who’s gaining on you.
          </p>
        </div>
        {proof}
      </div>
    </section>
  );
}
