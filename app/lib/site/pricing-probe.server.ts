import { readJudgedPricingUrl } from "../data/page.server";
import { readUrl } from "../fetch/transport.server";
import { extractIdentity } from "../identity/extract";
import { classifyNavPages, type NavPage } from "../identity/page-role.server";

const PRICING_PATHS = ["/pricing", "/plans", "/pricing-plans", "/plans-and-pricing", "/prices"] as const;

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

async function probeOne(url: string, homeTitle: string | null): Promise<NavPage | null> {
  const read = await readUrl(url);
  if (!read.ok) return null;
  const title = (await extractIdentity(read.html, url)).nameSources.title;
  if (title === null || title === homeTitle) return null;
  return { url, title };
}

export async function probePricingPages(input: {
  homepageUrl: string;
  homeTitle: string | null;
  known: readonly NavPage[];
}): Promise<NavPage[]> {
  const found: NavPage[] = [];
  for (const path of PRICING_PATHS) {
    const url = new URL(path, input.homepageUrl).href;
    if (input.known.some((page) => sameUrl(page.url, url))) continue;
    const page = await probeOne(url, input.homeTitle);
    if (page !== null) found.push(page);
  }
  return found;
}

export interface FindHiddenPricingInput {
  workspaceId: string;
  entity: { id: string; domain: string };
  homepageUrl: string;
  homeTitle: string | null;
  navPages: readonly NavPage[];
  now: string;
}

export async function findHiddenPricing(input: FindHiddenPricingInput): Promise<void> {
  if ((await readJudgedPricingUrl(input.entity.id)) !== null) return;
  const pages = await probePricingPages({
    homepageUrl: input.homepageUrl,
    homeTitle: input.homeTitle,
    known: input.navPages,
  });
  if (pages.length === 0) return;
  await classifyNavPages({ workspaceId: input.workspaceId, entity: input.entity, pages, now: input.now });
}
