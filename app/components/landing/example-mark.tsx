import { cn } from "../../lib/utils";

export function ExampleMark({ before, after, className }: { before: string; after: string; className: string }) {
  return (
    <p
      className={cn(
        "font-display flex min-w-0 flex-wrap items-baseline gap-x-[0.3em] font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]",
        className,
      )}
    >
      <s className="text-ink-soft decoration-red decoration-[length:0.09em]">
        <span className="sr-only">Before: </span>
        {before}
      </s>
      <span aria-hidden="true" className="text-ink-faint font-bold">
        →
      </span>
      <ins className="bg-green text-on-green px-[0.14em] no-underline [box-decoration-break:clone]">
        <span className="sr-only">Now: </span>
        {after}
      </ins>
    </p>
  );
}
