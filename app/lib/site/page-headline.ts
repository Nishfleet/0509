export interface PageHeadline {
  title: string;
  heading: string;
}

export async function readPageHeadline(html: string): Promise<PageHeadline> {
  const found = { title: "", heading: "", headingDone: false };
  const rewritten = new HTMLRewriter()
    .on("title", {
      text(chunk) {
        found.title += chunk.text;
      },
    })
    .on("h1", {
      element() {
        if (found.heading !== "") found.headingDone = true;
      },
      text(chunk) {
        if (!found.headingDone) found.heading += chunk.text;
      },
    })
    .transform(new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } }));
  await rewritten.arrayBuffer();
  return { title: found.title.trim(), heading: found.heading.trim() };
}

function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

export function namesBrand(headline: PageHeadline, brand: string): boolean {
  const needle = words(brand);
  if (needle.trim() === "") return false;
  return words(headline.title).includes(needle) || words(headline.heading).includes(needle);
}
