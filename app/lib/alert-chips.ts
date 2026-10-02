export const ALERT_CHIPS = [
  { key: "all", label: "All" },
  { key: "site-changes", label: "Site changes" },
  { key: "ads", label: "Ads" },
  { key: "mentions", label: "Mentions" },
  { key: "hiring", label: "Hiring" },
  { key: "content", label: "Blog posts" },
  { key: "your-site", label: "Your site" },
] as const;

export type AlertChipKey = (typeof ALERT_CHIPS)[number]["key"];

export type AlertItemKind = "change" | "note" | "failure" | "signal" | "mention" | "hiring" | "content";

export function parseAlertChip(value: string | null): AlertChipKey {
  return ALERT_CHIPS.find((chip) => chip.key === value)?.key ?? "all";
}

export function chipOfKind(kind: AlertItemKind): AlertChipKey | null {
  switch (kind) {
    case "change":
      return "site-changes";
    case "signal":
      return "ads";
    case "mention":
      return "mentions";
    case "hiring":
      return "hiring";
    case "content":
      return "content";
    case "note":
    case "failure":
      return null;
  }
}

export function itemInChip(kind: AlertItemKind, chip: AlertChipKey): boolean {
  if (chip === "all") return true;
  return chipOfKind(kind) === chip;
}

export function countAlertChips(kinds: readonly AlertItemKind[], incidentCount: number): Record<AlertChipKey, number> {
  let siteChanges = 0;
  let ads = 0;
  let mentions = 0;
  let hiring = 0;
  let content = 0;
  for (const kind of kinds) {
    const chip = chipOfKind(kind);
    if (chip === "site-changes") siteChanges += 1;
    else if (chip === "ads") ads += 1;
    else if (chip === "mentions") mentions += 1;
    else if (chip === "hiring") hiring += 1;
    else if (chip === "content") content += 1;
  }
  return {
    all: kinds.length + incidentCount,
    "site-changes": siteChanges,
    ads,
    mentions,
    hiring,
    content,
    "your-site": incidentCount,
  };
}
