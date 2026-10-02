import { getDomain, parse } from "tldts";

export const SITE_LINK_MAX = 200;

export const SITE_INVALID_ERROR = "That doesn't look like a website. Paste an address like adidas-group.com.";
export const SITE_TOO_LONG_ERROR = "That address is too long. Paste just the website, like adidas-group.com.";
export const SITE_SAME_ERROR =
  "That's the same website we already try. Paste a different one of theirs, like their corporate or press site.";
export const SITE_UNREADABLE_ERROR =
  "We couldn't read that website either. Try another page of it, like their news or investor page.";
export const SITE_ROBOTS_ERROR = "That website asks bots to stay out, so we can't watch it.";

function isPublicWebUrl(url: URL): boolean {
  const host = parse(url.hostname);
  const web = url.protocol === "https:" || url.protocol === "http:";
  return web && url.username === "" && url.password === "" && host.isIp !== true && host.isIcann === true;
}

export function parseSiteInput(
  raw: string,
  brandDomain: string,
): { ok: true; url: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length > SITE_LINK_MAX) return { ok: false, message: SITE_TOO_LONG_ERROR };
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(candidate)) return { ok: false, message: SITE_INVALID_ERROR };
  const url = new URL(candidate);
  if (!isPublicWebUrl(url)) return { ok: false, message: SITE_INVALID_ERROR };
  if (getDomain(url.hostname) === getDomain(brandDomain)) return { ok: false, message: SITE_SAME_ERROR };
  return { ok: true, url: `https://${url.hostname}${url.pathname}` };
}
