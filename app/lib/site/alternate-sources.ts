import { getDomain } from "tldts";

const OWN_HOST_LABELS = ["news", "newsroom", "press"] as const;

export function ownHostUrls(domain: string): string[] {
  const registrable = getDomain(domain);
  return registrable === null ? [] : OWN_HOST_LABELS.map((label) => `https://${label}.${registrable}/`);
}

export function offBrandSite(pageUrl: string, domain: string): string | null {
  const site = getDomain(pageUrl);
  return site === null || site === getDomain(domain) ? null : site;
}
