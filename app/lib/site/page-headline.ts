export async function readPageTitle(html: string): Promise<string> {
  let title = "";
  const rewritten = new HTMLRewriter()
    .on("title", {
      text(chunk) {
        title += chunk.text;
      },
    })
    .transform(new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } }));
  await rewritten.arrayBuffer();
  return title.trim();
}

const NOT_A_BRAND_PAGE = /\b(?:not found|404|error|no results|search|sign in|log in)\b/i;

function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

export function namesBrand(title: string, brand: string): boolean {
  const needle = words(brand);
  if (needle.trim() === "" || NOT_A_BRAND_PAGE.test(title)) return false;
  return words(title).includes(needle);
}
