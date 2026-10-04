export const SOURCE_KINDS = ["ads", "mentions", "site", "hiring", "content"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export function effectiveKindSql(alias: string): string {
  return `CASE WHEN ${alias}.platform = 'feed' THEN 'content' ELSE ${alias}.kind END`;
}
