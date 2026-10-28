import type { BriefPayload } from "./brief-payload";

type Incident = BriefPayload["own_site"]["incidents"][number];

export interface OwnSitePage {
  url: string;
  open: boolean;
  openedAt: string | null;
  closedAt: string | null;
}

export interface OwnSiteLines {
  headline: string;
  pages: readonly OwnSitePage[];
}

function merge(seen: OwnSitePage | undefined, incident: Incident): OwnSitePage {
  const openedAt = incident.opened_at ?? null;
  const closedAt = incident.closed_at ?? null;
  if (seen === undefined) return { url: incident.page_url, open: incident.is_open, openedAt, closedAt };
  const open = seen.open || incident.is_open;
  return {
    url: seen.url,
    open,
    openedAt: seen.openedAt === null || (openedAt !== null && openedAt < seen.openedAt) ? openedAt : seen.openedAt,
    closedAt: open ? null : [seen.closedAt, closedAt].reduce((a, b) => (a === null || (b !== null && b > a) ? b : a)),
  };
}

export function ownSiteLines(ownSite: BriefPayload["own_site"]): OwnSiteLines {
  const byUrl = new Map<string, OwnSitePage>();
  for (const incident of ownSite.incidents) byUrl.set(incident.page_url, merge(byUrl.get(incident.page_url), incident));
  const pages = [...byUrl.values()];
  if (pages.some((page) => page.open) || (ownSite.status === "broken" && pages.length === 0)) {
    return { headline: "Your site looks broken.", pages };
  }
  if (pages.length > 0) return { headline: "Your site looks fine now.", pages };
  return { headline: "Your site looks fine.", pages };
}

export function ownSitePageLine(page: OwnSitePage, when: (iso: string) => string): string {
  const seen =
    page.openedAt === null
      ? `We saw a problem on ${page.url}.`
      : `We saw a problem on ${page.url} at ${when(page.openedAt)}.`;
  if (page.open) return `${seen} It isn't fixed yet.`;
  return page.closedAt === null
    ? `${seen} It's fixed now.`
    : `${seen} We re-checked at ${when(page.closedAt)} and it was fixed.`;
}
