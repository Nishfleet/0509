export function countPhrase(count: number, one: string, many: string): string {
  if (count === 0) return `no ${many}`;
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

export function quietWeekLine(mentions: number, siteChanges: number, newAds: number): string {
  return `Quiet week: ${countPhrase(mentions, "mention", "mentions")}, ${countPhrase(siteChanges, "site change", "site changes")}, ${countPhrase(newAds, "new ad", "new ads")}.`;
}
