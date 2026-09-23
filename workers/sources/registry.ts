import type { MentionsAdapter } from "./mentions/types";

const ADAPTERS: Readonly<Record<string, MentionsAdapter>> = {};

export function adapterFor(pluginKey: string): MentionsAdapter | undefined {
	return ADAPTERS[pluginKey];
}
