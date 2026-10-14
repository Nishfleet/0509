import { decodeHtmlEntities } from "../html";

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
  return decodeHtmlEntities(parts.join("")).trim();
}
