export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  hellip: "\u2026",
  bull: "\u2022",
  middot: "\u00b7",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  euro: "\u20ac",
  pound: "\u00a3",
  yen: "\u00a5",
  cent: "\u00a2",
  deg: "\u00b0",
  times: "\u00d7",
  laquo: "\u00ab",
  raquo: "\u00bb",
};

function codePointOf(body: string): number | null {
  if (body.startsWith("#x")) return Number.parseInt(body.slice(2), 16);
  if (body.startsWith("#")) return Number.parseInt(body.slice(1), 10);
  return null;
}

function decodeEntity(match: string, body: string): string {
  const lower = body.toLowerCase();
  const code = codePointOf(lower);
  if (code === null) return NAMED_ENTITIES[lower] ?? match;
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(ENTITY, decodeEntity);
}
