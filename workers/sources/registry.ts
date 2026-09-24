import type { MentionsAdapter } from "./mentions/types";
import { hnAdapter } from "./mentions/hn";

const ADAPTERS: Readonly<Record<string, MentionsAdapter>> = {
	"hn.algolia": hnAdapter,
};

export function adapterFor(pluginKey: string): MentionsAdapter | undefined {
	return ADAPTERS[pluginKey];
}
