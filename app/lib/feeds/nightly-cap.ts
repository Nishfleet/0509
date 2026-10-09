export const MAX_FEED_FINDS_PER_NIGHT = 3000;
export const MAX_FEED_READS_PER_NIGHT = 3000;

const DAY_MS = 86_400_000;

interface Capped<T> {
  readonly kept: readonly T[];
  readonly dropped: number;
}

export function capForNight<T>(items: readonly T[], cap: number, now: Date): Capped<T> {
  if (items.length <= cap) return { kept: items, dropped: 0 };
  const start = (Math.floor(now.getTime() / DAY_MS) * cap) % items.length;
  const rotated = [...items.slice(start), ...items.slice(0, start)];
  return { kept: rotated.slice(0, cap), dropped: items.length - cap };
}
