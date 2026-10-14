export function countPhrase(count: number, one: string, many: string): string {
  if (count === 0) return `no ${many}`;
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

export function quietWeekLine(mentions: number, siteChanges: number, newAds: number): string {
  return `Quiet week: ${countPhrase(mentions, "mention", "mentions")}, ${countPhrase(siteChanges, "site change", "site changes")}, ${countPhrase(newAds, "new ad", "new ads")}.`;
}

export function firstBriefLine(rivals: number): string {
  const who = rivals === 1 ? "your rival stands" : `your ${String(rivals)} rivals stand`;
  return `This is your starting point: where ${who} today, before anything changes. We'll tell you the moment one moves.`;
}
