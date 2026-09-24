import type { MentionsAdapter } from "./mentions/types";
import { gdelt } from "./mentions/gdelt";
import { hnAdapter } from "./mentions/hn";
import { mediumAdapter } from "./mentions/medium";
import { youtubeAdapter } from "./mentions/youtube";

const ADAPTERS: Readonly<Record<string, MentionsAdapter>> = {
	"gdelt.doc": gdelt,
	"hn.algolia": hnAdapter,
	"youtube.channel_rss": youtubeAdapter,
	"medium.tag_rss": mediumAdapter,
};

export function adapterFor(pluginKey: string): MentionsAdapter | undefined {
	return ADAPTERS[pluginKey];
}
