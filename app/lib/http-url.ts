export function httpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let href: string | null;
  try {
    href = new URL(trimmed).href;
  } catch (error) {
    console.error(JSON.stringify({ event: "http_url.parse_failed", error: String(error) }));
    href = null;
  }
  if (href === null) return null;
  const protocol = new URL(href).protocol;
  if (protocol !== "http:" && protocol !== "https:") return null;
  return href;
}
