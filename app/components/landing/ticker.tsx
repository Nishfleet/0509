import { type TickerItem } from "../../lib/ticker";

const listClass =
  "flex shrink-0 items-center gap-10 pr-10 font-mono text-eyebrow uppercase whitespace-nowrap";

export function Ticker({ items }: { items: readonly TickerItem[] }) {
  const animating = items.length > 0;
  return (
    <div
      id="ticker"
      role="region"
      aria-label="Changes caught recently"
      className="bg-ink text-bone h-9 overflow-hidden"
    >
      {animating ? (
        <div className="flex h-full w-max items-center animate-[ticker_60s_linear_infinite] motion-reduce:animate-none">
          <ul className={listClass}>
            {items.map((item) => (
              <li key={item.id} data-signal-id={item.id}>
                <span>{item.text}</span> <span className="opacity-70">{item.ago}</span>
              </li>
            ))}
          </ul>
          <ul aria-hidden="true" className={listClass}>
            {items.map((item) => (
              <li key={item.id}>
                <span>{item.text}</span> <span className="opacity-70">{item.ago}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
