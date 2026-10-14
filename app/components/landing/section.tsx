import type { ReactNode } from "react";

export const pageWidth = "mx-auto w-full max-w-[84rem] px-5 sm:px-10 lg:px-14";

export const eyebrow = "font-mono text-eyebrow font-medium uppercase";

function Heading({ page, id, children }: { page: boolean; id: string; children: ReactNode }) {
  const className = "mt-3 max-w-[24ch] font-display text-display-3 font-extrabold uppercase";
  return page ? (
    <h1 id={id} className={className}>
      {children}
    </h1>
  ) : (
    <h2 id={id} className={className}>
      {children}
    </h2>
  );
}

export function Section({
  id,
  kicker,
  title,
  lead,
  page = false,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  lead?: string;
  page?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={page ? "scroll-mt-4" : "scroll-mt-4 border-t border-line"}
    >
      <div className={`${pageWidth} ${page ? "pt-10 pb-16 sm:pt-12 sm:pb-24" : "py-16 sm:py-24"}`}>
        <p className={`${eyebrow} text-ink-soft`}>{kicker}</p>
        <Heading page={page} id={`${id}-title`}>
          {title}
        </Heading>
        {lead === undefined ? null : (
          <p className="mt-5 max-w-[42rem] text-[1.05rem] leading-[1.6] text-ink-soft">{lead}</p>
        )}
        <div className="mt-10 min-w-0">{children}</div>
      </div>
    </section>
  );
}
