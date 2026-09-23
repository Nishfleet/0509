import type { MentionAdapter } from "./mentions/types";

const ADAPTERS: Record<string, MentionAdapter> = {};

export function adapterFor(pluginKey: string): MentionAdapter | null {
  return ADAPTERS[pluginKey] ?? null;
}
