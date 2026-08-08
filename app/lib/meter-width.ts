/**
 * The one meter-fill class resolver (CSS endgame review, Grok/Sol). A
 * meter's fill is data-driven, but its rendering is a class, never an
 * inline style. Exact 1% steps; values clamp to [0, 100]; a non-zero
 * value never rounds to an invisible zero.
 */
export function meterWidthClass(percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const step = Math.round(clamped);
  const floored = clamped > 0 && step === 0 ? 1 : step;
  return `f9-wk-meter-fill f9-wk-w${floored}`;
}
