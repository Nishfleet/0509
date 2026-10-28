export function quietWithChanges(quiet: string, weekCount: number): string {
  if (weekCount === 0) return quiet;
  return `${quiet} We saw ${String(weekCount)} page ${weekCount === 1 ? "change" : "changes"} in that time; ${weekCount === 1 ? "it did not stand out" : "none stood out"}.`;
}
