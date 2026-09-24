import type { ReactElement, ReactNode } from "react";

export function PageHeading({ title, lede }: { title: string; lede?: ReactNode }): ReactElement {
  return (
    <header className="min-w-0">
      <h1 className="font-display text-display-2 font-extrabold break-words uppercase">{title}</h1>
      {lede === undefined ? null : <p className="text-ink-soft mt-3 max-w-prose leading-[1.55]">{lede}</p>}
    </header>
  );
}

export const BLOCK_HEADING = "font-mono text-eyebrow text-ink-soft uppercase";

export const PAGE = "mx-auto w-full max-w-3xl min-w-0 px-4 py-10 sm:px-8";
export const ONBOARDING_PAGE = "mx-auto w-full max-w-2xl min-w-0 px-5 py-8 sm:px-8 sm:py-12";
