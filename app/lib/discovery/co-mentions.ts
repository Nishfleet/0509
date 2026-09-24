const WORD_START = /^[A-Z0-9]/;

const CLAUSE_SPLIT = /[:|?!()]| - | – | — /;

const ITEM_SPLIT = / and | & | vs\. | vs | versus | or /i;

const MINOR_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "versus", "vs", "vs.", "with",
]);

function isTitleCase(text: string): boolean {
  const words = text
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word) && !MINOR_WORDS.has(word.toLowerCase()));
  return words.length >= 2 && words.every((word) => WORD_START.test(word));
}

export function leadingName(item: string): string | null {
  const run: string[] = [];
  for (const word of item.trim().split(/\s+/)) {
    if (!WORD_START.test(word)) break;
    run.push(word);
  }
  return run.length >= 1 && run.length <= 4 ? run.join(" ") : null;
}

export function coMentions(text: string, brand: string): string[] {
  const needle = brand.toLowerCase();
  if (!text.toLowerCase().includes(needle)) return [];

  const titleCase = isTitleCase(text);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const clause of text.split(CLAUSE_SPLIT)) {
    if (!clause.toLowerCase().includes(needle)) continue;

    const items = clause
      .split(",")
      .flatMap((piece) => piece.split(ITEM_SPLIT))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (items.length < 2) continue;

    for (const [index, item] of items.entries()) {
      if (item.toLowerCase().includes(needle)) continue;
      if (titleCase && index === items.length - 1) continue;
      const name = leadingName(item);
      if (name === null || name.toLowerCase() === needle) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(name);
    }
  }
  return found;
}
