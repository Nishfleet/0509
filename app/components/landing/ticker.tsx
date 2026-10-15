import { type TickerItem } from "../../lib/ticker";

const listClass = "flex shrink-0 items-center gap-10 pr-10 font-mono text-eyebrow uppercase whitespace-nowrap";
const toggleClass =
  "absolute inset-y-0 right-0 z-10 flex cursor-pointer items-center bg-ink px-4 font-mono text-eyebrow uppercase after:content-['Pause'] peer-checked:after:content-['Play'] peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-bone";

function Strip({ items, hidden }: { items: readonly TickerItem[]; hidden: boolean }) {
  return (
    <ul aria-hidden={hidden ? "true" : undefined} className={listClass}>
      {items.map((item) => (
        <li key={item.id} data-signal-id={hidden ? undefined : item.id}>
          <span>{item.text}</span> <span className="opacity-70">{item.ago}</span>
        </li>
      ))}
    </ul>
  );
}

function Looping({ items }: { items: readonly TickerItem[] }) {
  return (
    <>
      <input type="checkbox" id="ticker-pause" aria-label="Pause the ticker" className="peer sr-only" />
      <label htmlFor="ticker-pause" className={toggleClass} />
      <div className="flex h-full w-max animate-[ticker_60s_linear_infinite] items-center peer-checked:[animation-play-state:paused] motion-reduce:animate-none">
        <Strip items={items} hidden={false} />
        <Strip items={items} hidden />
      </div>
    </>
  );
}

export function Ticker({ items }: { items: readonly TickerItem[] }) {
  return (
    <div
      id="ticker"
      role="region"
      aria-label="Changes caught recently"
      className="relative h-9 overflow-hidden bg-ink text-bone"
    >
      {items.length > 0 ? <Looping items={items} /> : <div className="flex h-full w-max items-center" />}
    </div>
  );
}
