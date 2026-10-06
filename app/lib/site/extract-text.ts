import { sha256Hex } from "../sha256";

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden/i;

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

const ALWAYS_HIDDEN_TAGS = new Set(["script", "style", "noscript", "template"]);

const PARAGRAPH_CLOSERS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
];

const CELL_CLOSERS = ["td", "th", "tr", "tbody", "tfoot"];

const IMPLIED_END_TAG_CLOSERS: Readonly<Record<string, ReadonlySet<string>>> = {
  p: new Set(PARAGRAPH_CLOSERS),
  li: new Set(["li"]),
  dt: new Set(["dt", "dd"]),
  dd: new Set(["dt", "dd"]),
  tr: new Set(["tr", "tbody", "tfoot"]),
  td: new Set(CELL_CLOSERS),
  th: new Set(CELL_CLOSERS),
  option: new Set(["option", "optgroup"]),
  optgroup: new Set(["optgroup"]),
};

export interface ExtractedPageText {
  text: string;
  hash: string;
  charCount: number;
}

interface OpenElement {
  tag: string;
  hidden: boolean;
}

interface ExtractState {
  open: readonly OpenElement[];
  pending: string;
  parts: string[];
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isHidden(element: Element): boolean {
  return (
    ALWAYS_HIDDEN_TAGS.has(element.tagName.toLowerCase()) ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    HIDDEN_STYLE.test(element.getAttribute("style") ?? "")
  );
}

function withoutImpliedEnds(open: readonly OpenElement[], tag: string): readonly OpenElement[] {
  const top = open.at(-1);
  if (top === undefined || !IMPLIED_END_TAG_CLOSERS[top.tag]?.has(tag)) return open;
  return withoutImpliedEnds(open.slice(0, -1), tag);
}

function withoutClosed(open: readonly OpenElement[], tag: string): readonly OpenElement[] {
  const index = open.map((entry) => entry.tag).lastIndexOf(tag);
  return index === -1 ? open : open.slice(0, index);
}

function enterElement(state: ExtractState, element: Element): void {
  const tag = element.tagName.toLowerCase();
  state.open = withoutImpliedEnds(state.open, tag);
  if (VOID_ELEMENTS.has(tag) || element.selfClosing || element.canHaveContent === false) return;
  state.open = [...state.open, { tag, hidden: isHidden(element) }];
  element.onEndTag(() => {
    state.open = withoutClosed(state.open, tag);
  });
}

export async function extractPageText(html: string): Promise<ExtractedPageText> {
  const state: ExtractState = { open: [], pending: "", parts: [] };

  const rewritten = new HTMLRewriter()
    .on("*", {
      element(element) {
        enterElement(state, element);
      },
      text(chunk) {
        if (state.open.some((entry) => entry.hidden)) return;
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
