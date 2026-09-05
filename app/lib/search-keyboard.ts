/**
 * Keyboard basics for the search results list (workflow-friction pass):
 * j/k or arrow keys move the highlight, Enter opens the highlighted ad,
 * s quick-saves it. Pure helpers so the route listener stays thin.
 */

export function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Next highlight index for a navigation key, or null when the key is not a
 * navigation key. First press highlights the first result; movement clamps
 * at both ends instead of wrapping.
 */
export function nextSearchResultIndex(
  key: string,
  current: number | null,
  count: number,
): number | null {
  if (count <= 0) {
    return null;
  }
  const forward = key === "j" || key === "ArrowDown";
  const backward = key === "k" || key === "ArrowUp";
  if (!forward && !backward) {
    return null;
  }
  if (current === null) {
    return 0;
  }
  const next = forward ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), count - 1);
}

export const SEARCH_KEYBOARD_HINTS = [
  { keys: "j / k or ↓ / ↑", action: "Move between results" },
  { keys: "Enter", action: "Open the highlighted ad" },
  { keys: "s", action: "Save the highlighted ad" },
  { keys: "?", action: "Show or hide these shortcuts" },
] as const;
