import { cn } from "../lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <a href="/" className={cn("font-display text-[1.05rem] font-extrabold tracking-[-0.03em]", className)}>
      <span className="sr-only">Five to Nine</span>
      <span aria-hidden="true">
        05<span className="bg-green text-on-green px-[5px]">09</span>
      </span>
    </a>
  );
}
