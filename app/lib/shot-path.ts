const SHOT_PREFIX = "snapshot/site/";

export type ChangeBand = "publish" | "uncertain" | "alert" | "check";

export function shotPath(id: string, side: "before" | "after"): string {
  return `/app/changes/${encodeURIComponent(id)}/${side}`;
}

export function isShotKey(key: string | null): key is string {
  return key?.startsWith(SHOT_PREFIX) === true;
}
