import { defaultFetchText } from "../discovery/fetch-text.server";
import { readPageNames } from "../discovery/page-names";

const NAME_MAX = 80;

export async function readCompetitorName(domain: string): Promise<string | null> {
  const page = await defaultFetchText("competitor.name_fetch_failed", 5_000)(`https://${domain}/`);
  if (!page.ok) return null;
  const names = await readPageNames(page.body);
  const name = (names.ogSiteName ?? names.ldOrganizationName ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name === "" || name.length > NAME_MAX ? null : name;
}
