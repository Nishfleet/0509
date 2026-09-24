import type { MentionsAdapter } from "./mentions/types";
import { gdelt } from "./mentions/gdelt";
import { hnAdapter } from "./mentions/hn";

const ADAPTERS: Readonly<Record<string, MentionsAdapter>> = {
	"gdelt.doc": gdelt,
	"hn.algolia": hnAdapter,
};

export function adapterFor(pluginKey: string): MentionsAdapter | undefined {
	return ADAPTERS[pluginKey];
}
