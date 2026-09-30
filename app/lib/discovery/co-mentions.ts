const WORD_START = /^[A-Z0-9]/;

const CLAUSE_SPLIT = /[:|?!()]| - | – | — /;

const ITEM_SPLIT = / and | & | vs\. | vs | versus | or /i;

const MINOR_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "versus",
  "vs",
  "vs.",
  "with",
]);

function isTitleCase(text: string): boolean {
  const words = text.split(/\s+/).filter((word) => /\p{L}/u.test(word) && !MINOR_WORDS.has(word.toLowerCase()));
  return words.length >= 2 && words.every((word) => WORD_START.test(word));
}

export function leadingName(item: string): string | null {
  const run: string[] = [];
  for (const word of item.trim().split(/\s+/)) {
    if (!WORD_START.test(word)) break;
    run.push(word);
  }
  return run.length >= 1 && run.length <= 4 ? run.join(" ").replace(/[.,;]+$/, "") : null;
}

const LIST_INTRO = /\b(?:like|such as|including|e\.g\.,?|for example)\s+(.+)$/i;

const RIVAL_CUE =
  /\b(?:are|is)\s+(?:\w+\s+){0,2}?(?:alternatives?|competitors?|rivals?)\b|\b(?:better|cheaper) than\b/i;

function namesBesideBrand(item: string, needle: string): string[] {
  const at = item.toLowerCase().indexOf(needle);
  const tail = LIST_INTRO.exec(item.slice(at + needle.length))?.[1];
  const listed = tail === undefined ? null : leadingName(tail);
  const cued = at > 0 && RIVAL_CUE.test(item.slice(0, at)) ? leadingName(item) : null;
  return [listed, cued].filter((name): name is string => name !== null);
}

function clauseNames(clause: string, needle: string, titleCase: boolean): string[] {
  const items = clause
    .split(",")
    .flatMap((piece) => piece.split(ITEM_SPLIT))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return items.flatMap((item, index) => {
    if (item.toLowerCase().includes(needle)) return namesBesideBrand(item, needle);
    if (titleCase && index === items.length - 1) return [];
    const name = leadingName(item);
    return name === null ? [] : [name];
  });
}

export function coMentions(text: string, brand: string): string[] {
  const needle = brand.toLowerCase();
  if (!text.toLowerCase().includes(needle)) return [];

  const titleCase = isTitleCase(text);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const clause of text.split(CLAUSE_SPLIT)) {
    if (!clause.toLowerCase().includes(needle)) continue;
    for (const name of clauseNames(clause, needle, titleCase)) {
      const key = name.toLowerCase();
      if (key === needle || seen.has(key)) continue;
      seen.add(key);
      found.push(name);
    }
  }
  return found;
}
