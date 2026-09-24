import { leadingName } from "./co-mentions";

const HEADING_SELECTOR = "h2, h3";

const LEADING_NUMBER = /^\d+[.)]?\s*/;

interface HeadingState {
  buffer: string;
  headings: string[];
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function headingName(raw: string): string {
  let text = collapseWhitespace(raw);
  text = text.replace(LEADING_NUMBER, "");
  const colon = text.lastIndexOf(":");
  if (colon >= 0) text = text.slice(colon + 1).trim();
  return text;
}

export async function harvestHeadings(html: string, brand: string): Promise<string[]> {
  const state: HeadingState = { buffer: "", headings: [] };

  const rewritten = new HTMLRewriter()
    .on(HEADING_SELECTOR, {
      element(element) {
        state.buffer = "";
        element.onEndTag(() => {
          state.headings.push(state.buffer);
          state.buffer = "";
        });
      },
      text(chunk) {
        state.buffer += chunk.text;
      },
    })
    .transform(new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } }));

  await rewritten.arrayBuffer();

  const needle = brand.toLowerCase();
  const found: string[] = [];
  const seen = new Set<string>();
  for (const heading of state.headings) {
    const name = leadingName(headingName(heading));
    if (name === null) continue;
    const key = name.toLowerCase();
    if (key === needle || seen.has(key)) continue;
    seen.add(key);
    found.push(name);
  }
  return found;
}
