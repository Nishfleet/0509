/**
 * Watch-board ticker — brief §7 (the ONE ticker in the workspace) and §9.7
 * (one line, clipped, paused under `prefers-reduced-motion`).
 *
 * Every entry is a stored fact about a real competitor, produced by
 * `buildWatchBoardTickerItems`: caught counts, quiet runs, first checks,
 * pauses. There is no filler line and nothing here is invented.
 *
 * The belt is `aria-hidden`: the same facts are the bands underneath it, so
 * a screen reader gets them once, in a readable order, instead of twice as a
 * duplicated marquee.
 */

export function WatchBoardTicker({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;

  // Two identical runs give the belt a seamless loop.
  const runs = [0, 1];

  return (
    <div aria-hidden="true" className="f9-ed-ticker">
      <div className="f9-ed-ticker-belt">
        {runs.map((run) => (
          <div className="f9-ed-ticker-run" key={run}>
            {items.map((item, index) => (
              <span className="f9-ed-ticker-item" key={`${run}-${index}-${item}`}>
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
