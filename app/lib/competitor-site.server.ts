import { parseSiteInput, SITE_ROBOTS_ERROR, SITE_UNREADABLE_ERROR } from "./competitor-site";
import { readCompetitor } from "./data/entity.server";
import { insertAlternatePage } from "./data/page.server";
import { readEnabledSourceId } from "./data/source.server";
import { recordAlternateAttempt, retireCustomerSites } from "./data/watch.server";
import { robotsAllows } from "./fetch/robots.server";
import { readUrl } from "./fetch/transport.server";

export async function saveCompetitorSite(
  workspaceId: string,
  entityId: string,
  raw: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const competitor = await readCompetitor(workspaceId, entityId);
  const sourceId = await readEnabledSourceId("site.web");
  if (competitor === null || sourceId === null) return { ok: false, message: "We don't track that competitor." };
  const parsed = parseSiteInput(raw, competitor.domain);
  if (!parsed.ok) return parsed;
  if (!(await robotsAllows(parsed.url))) return { ok: false, message: SITE_ROBOTS_ERROR };
  const read = await readUrl(parsed.url);
  if (!read.ok) return { ok: false, message: SITE_UNREADABLE_ERROR };
  const at = new Date().toISOString();
  await recordAlternateAttempt({
    entityId,
    sourceId,
    url: parsed.url,
    at,
    outcome: { adopted: true },
    origin: "customer",
  });
  await insertAlternatePage({ entityId, url: parsed.url, role: "other", transport: read.transport, at });
  await retireCustomerSites(entityId, parsed.url);
  return { ok: true };
}
