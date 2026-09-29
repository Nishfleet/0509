import { cn } from "../../lib/utils";

export function ExampleMark({ before, after, className }: { before: string; after: string; className: string }) {
  return (
    <p
      className={cn(
        "flex min-w-0 flex-wrap items-baseline gap-x-[0.3em] font-display font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]",
        className,
      )}
    >
      <s className="text-ink-soft decoration-red decoration-[length:0.09em]">
        <span className="sr-only">Before: </span>
        {before}
      </s>
      <span aria-hidden="true" className="font-bold text-ink-faint">
        →
      </span>
      <ins className="bg-green [box-decoration-break:clone] px-[0.14em] text-on-green no-underline">
        <span className="sr-only">Now: </span>
        {after}
      </ins>
    </p>
  );
}
