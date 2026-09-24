import type { ReactNode } from "react";

export const pageWidth = "mx-auto w-full max-w-[84rem] px-5 sm:px-10 lg:px-14";

export const eyebrow = "font-mono text-eyebrow font-medium uppercase";

export function Section({
  id,
  kicker,
  title,
  lead,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-line scroll-mt-4 border-t">
      <div className={`${pageWidth} py-16 sm:py-24`}>
        <p className={`${eyebrow} text-ink-soft`}>{kicker}</p>
        <h2 id={`${id}-title`} className="font-display text-display-3 mt-3 max-w-[24ch] font-extrabold uppercase">
          {title}
        </h2>
        {lead === undefined ? null : (
          <p className="text-ink-soft mt-5 max-w-[42rem] text-[1.05rem] leading-[1.6]">{lead}</p>
        )}
        <div className="mt-10 min-w-0">{children}</div>
      </div>
    </section>
  );
}
