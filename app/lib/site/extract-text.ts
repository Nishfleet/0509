const SKIP_SELECTOR = "script, style, noscript, [aria-hidden='true']";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export interface ExtractedPageText {
  text: string;
  hash: string;
  charCount: number;
}

interface ExtractState {
  skip: number;
  pending: string;
  parts: string[];
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function extractPageText(html: string): Promise<ExtractedPageText> {
  const state: ExtractState = { skip: 0, pending: "", parts: [] };

  const rewritten = new HTMLRewriter()
    .on(SKIP_SELECTOR, {
      element(element) {
        if (VOID_ELEMENTS.has(element.tagName.toLowerCase())) return;
        state.skip += 1;
        element.onEndTag(() => {
          state.skip -= 1;
        });
      },
    })
    .on("*", {
      text(chunk) {
        if (state.skip > 0) return;
        state.pending += chunk.text;
        if (!chunk.lastInTextNode) return;
        state.parts.push(state.pending);
        state.pending = "";
      },
    })
    .transform(new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } }));

  await rewritten.arrayBuffer();

  if (state.pending.length > 0) {
    state.parts.push(state.pending);
  }

  const text = collapseWhitespace(state.parts.join(" "));
  const hash = await sha256Hex(text);
  return { text, hash, charCount: text.length };
}

export function hasChanged(prevHash: string, nextHash: string): boolean {
  return prevHash !== nextHash;
}
