const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  amazon: "Amazon",
  apple: "Apple",
  ashby: "Ashby",
  feed: "Blog and changelog",
  gdelt: "News",
  google: "Google",
  greenhouse: "Greenhouse",
  hn: "Hacker News",
  lever: "Lever",
  linkedin: "LinkedIn",
  medium: "Medium",
  meta: "Meta",
  pinterest: "Pinterest",
  reddit: "Reddit",
  smartrecruiters: "SmartRecruiters",
  snap: "Snapchat",
  tiktok: "TikTok",
  workable: "Workable",
  x: "X",
  youtube: "YouTube",
};

const KIND_NOUNS: Readonly<Record<string, string>> = {
  ads: "ads",
  mentions: "mentions",
  site: "site checks",
  hiring: "job posts",
  content: "posts",
};

export function sourceName(kind: string, platform: string): string {
  if (kind === "site") return "Website checks";
  const noun = KIND_NOUNS[kind] ?? "updates";
  const brand = PLATFORM_NAMES[platform];
  return brand === undefined ? `Your ${noun} source` : `${brand} ${noun}`;
}

export const OTHER_SOURCES = "other sources";

export function platformName(platform: string): string {
  if (platform === "web") return "Website";
  return PLATFORM_NAMES[platform] ?? OTHER_SOURCES;
}

export function sourceKindNoun(kind: string): string {
  return KIND_NOUNS[kind] ?? kind;
}

export function watchedNames(platforms: readonly string[]): string[] {
  const names = [...new Set(platforms.map(platformName))];
  return [...names.filter((name) => name !== OTHER_SOURCES), ...names.filter((name) => name === OTHER_SOURCES)];
}
