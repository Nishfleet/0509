const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
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

export async function htmlToText(html: string): Promise<string> {
  const parts: string[] = [];
  const rewriter = new HTMLRewriter()
    .on("p, br", {
      element() {
        parts.push("\n");
      },
    })
    .on("*", {
      text(chunk) {
        parts.push(chunk.text);
      },
    });
  await rewriter.transform(new Response(`<div>${html}</div>`)).text();
  return parts.join("").replace(ENTITY, decodeEntity).trim();
}
