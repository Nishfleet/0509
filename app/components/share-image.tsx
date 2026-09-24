import type { ReactElement } from "react";

import { brandMonogram } from "./brand-chip";
import type { ShareCard } from "../lib/share-card";

export const SHARE_IMAGE_SIZE = 1080;

export function ShareImage({ card }: { card: ShareCard }): ReactElement {
  return (
    <main data-share="image" className="bg-bone text-ink flex size-[1080px] flex-col justify-between p-[88px]">
      <header className="flex items-center justify-between">
        <span className="font-display text-[48px] font-extrabold">
          05<span className="bg-green text-on-green px-[10px]">09</span>
        </span>
        <span className="text-ink-soft font-mono text-[26px] tracking-[0.16em] uppercase">{card.week}</span>
      </header>
      <section className="min-w-0">
        <p className="flex min-w-0 items-center gap-6">
          <span
            aria-hidden="true"
            className="font-display bg-green border-ink flex size-[96px] shrink-0 items-center justify-center border-[3px] text-[44px] font-extrabold"
          >
            {brandMonogram(card.brand)}
          </span>
          <span className="font-display min-w-0 text-[60px] leading-[1.1] font-bold break-words">{card.brand}</span>
        </p>
        <p className="font-display mt-12 text-[168px] leading-[1] font-extrabold tracking-[-0.045em] uppercase">
          <span className="bg-green text-on-green px-[0.14em]">#{card.rank}</span> of {card.total}
        </p>
        <p className="font-display mt-6 text-[72px] leading-[1] font-extrabold tracking-[-0.04em] uppercase">
          this week
        </p>
      </section>
      <footer className="border-ink flex items-center justify-between border-t-[3px] pt-8 font-mono text-[28px] tracking-[0.12em] uppercase">
        <span>Know where you stand</span>
        <span>0509.io</span>
      </footer>
    </main>
  );
}
