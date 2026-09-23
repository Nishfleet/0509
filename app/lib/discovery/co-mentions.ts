const WORD_START = /^[A-Z0-9]/;

const CLAUSE_SPLIT = /[:|?!()]| - | – | — /;

const ITEM_SPLIT = / and | & | vs\. | vs | versus | or /i;

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

    for (const item of items) {
      if (item.toLowerCase().includes(needle)) continue;
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
