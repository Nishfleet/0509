export function countPhrase(count: number, one: string, many: string): string {
  if (count === 0) return `no ${many}`;
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

export function quietWeekLine(mentions: number, siteChanges: number, newAds: number): string {
  const seen = [
    mentions === 0 ? null : countPhrase(mentions, "mention", "mentions"),
    siteChanges === 0 ? null : countPhrase(siteChanges, "site change", "site changes"),
    newAds === 0 ? null : countPhrase(newAds, "new ad", "new ads"),
  ].filter((part) => part !== null);
  if (seen.length === 0) return "Quiet week: nothing new from your competitors.";
  const last = seen.at(-1);
  const list = seen.length === 1 ? String(last) : `${seen.slice(0, -1).join(", ")} and ${String(last)}`;
  return `Quiet week: we checked ${list}, and none of it needed your attention.`;
}

export function firstBriefLine(rivals: number): string {
  const who = rivals === 1 ? "your competitor stands" : `your ${String(rivals)} competitors stand`;
  return `This is your starting point: where ${who} today, before anything changes. When one moves, your next brief says so.`;
}

export function firstRunHeadline(arrivesAt: string, rivals: number): string {
  const noun = rivals === 1 ? "competitor" : "competitors";
  return `Your first brief arrives ${arrivesAt}. Watching ${String(rivals)} ${noun} from tonight.`;
}
