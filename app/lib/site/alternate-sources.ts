import { getDomain } from "tldts";

type AlternateRole = "blog" | "pricing";

export interface AlternateCandidate {
  url: string;
  role: AlternateRole;
  brand: string | null;
}

const OWN_HOST_LABELS = ["news", "newsroom", "press"] as const;

const RETAILER_BRAND_PAGES: readonly ((brand: string) => string)[] = [
  (brand) => `https://www.zalando.co.uk/${brand}/`,
  (brand) => `https://www.footlocker.co.uk/en/category/brands/${brand}.html`,
  (brand) => `https://www.jdsports.co.uk/brand/${brand}/`,
];

export function brandToken(domain: string): string | null {
  const registrable = getDomain(domain);
  const label = registrable?.split(".")[0];
  return label === undefined || label === "" ? null : label;
}

export function ownHostUrls(domain: string): string[] {
  const registrable = getDomain(domain);
  return registrable === null ? [] : OWN_HOST_LABELS.map((label) => `https://${label}.${registrable}/`);
}

export function alternateCandidates(domain: string): AlternateCandidate[] {
  const own = ownHostUrls(domain).map((url) => ({ url, role: "blog" as const, brand: null }));
  const brand = brandToken(domain);
  const retail =
    brand === null ? [] : RETAILER_BRAND_PAGES.map((page) => ({ url: page(brand), role: "pricing" as const, brand }));
  return [...own, ...retail];
}

export function isOffBrandHost(pageUrl: string, domain: string): boolean {
  return getDomain(new URL(pageUrl).hostname) !== getDomain(domain);
}
