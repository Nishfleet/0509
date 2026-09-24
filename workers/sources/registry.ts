import { gdelt } from "./mentions/gdelt";
import { hackerNews } from "./mentions/hacker-news";
import type { MentionsAdapter } from "./mentions/types";

const ADAPTERS: Readonly<Record<string, MentionsAdapter>> = {
  "gdelt.doc": gdelt,
  "hn.algolia": hackerNews,
};

export function adapterFor(pluginKey: string): MentionsAdapter | undefined {
  return ADAPTERS[pluginKey];
}
