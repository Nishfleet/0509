const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  amazon: "Amazon",
  apple: "Apple",
  gdelt: "News",
  google: "Google",
  greenhouse: "Greenhouse",
  hn: "Hacker News",
  linkedin: "LinkedIn",
  medium: "Medium",
  meta: "Meta",
  pinterest: "Pinterest",
  reddit: "Reddit",
  snap: "Snapchat",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
};

const KIND_NOUNS: Readonly<Record<string, string>> = {
  ads: "ads",
  mentions: "mentions",
  site: "site checks",
  hiring: "job posts",
};

export function sourceName(kind: string, platform: string): string {
  const noun = KIND_NOUNS[kind] ?? "updates";
  const brand = PLATFORM_NAMES[platform];
  return brand === undefined ? `Your ${noun} source` : `${brand} ${noun}`;
}
