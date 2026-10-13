import { z } from "zod";

import { BlockedRedirectError, cappedText, fetchOutbound } from "../fetch/outbound.server";
import { CRAWLER_USER_AGENT } from "../fetch/robots.server";
import {
  channelIdFromHtml,
  channelIdFromUrl,
  identityHasYoutubeUrl,
  isYoutubeChannelId,
  youtubePageUrl,
  youtubeUrlFromIdentity,
} from "../mentions/youtube-channel";
import type { Subject } from "./normalise";
import { cachedProbe } from "./probe-cache.server";

const cachedChannel = z.object({
  channelId: z.string().refine(isYoutubeChannelId),
});

export type YoutubeChannelLookup =
  { status: "id"; channelId: string } | { status: "no-url" } | { status: "unresolved"; reason?: string };

const MAX_PAGE_BYTES = 5 * 1024 * 1024;

class YoutubePageMiss extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoutubePageMiss";
  }
}

async function readYoutubeChannelPage(pageUrl: string): Promise<{ channelId: string }> {
  let response: Response;
  try {
    response = await fetchOutbound(pageUrl, {
      headers: { "user-agent": CRAWLER_USER_AGENT, cookie: "SOCS=CAI" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    if (
      error instanceof BlockedRedirectError ||
      error instanceof TypeError ||
      (error instanceof Error && error.name === "TimeoutError")
    ) {
      throw new YoutubePageMiss(error.message);
    }
    throw error;
  }
  if (!response.ok) throw new YoutubePageMiss(`youtube page ${String(response.status)}`);
  const html = await cappedText(response, MAX_PAGE_BYTES);
  if (html === null) throw new YoutubePageMiss("youtube page too large");
  const id = channelIdFromHtml(html);
  if (id === null)
    throw new YoutubePageMiss(
      `youtube page had no channel id (${String(response.status)}, ${String(html.length)} chars)`,
    );
  return { channelId: id };
}

export async function lookupYoutubeChannel(identityJson: string): Promise<YoutubeChannelLookup> {
  const url = youtubeUrlFromIdentity(identityJson);
  if (url === null) return { status: identityHasYoutubeUrl(identityJson) ? "unresolved" : "no-url" };
  const fromUrl = channelIdFromUrl(url);
  if (fromUrl !== null) return { status: "id", channelId: fromUrl };
  const pageUrl = youtubePageUrl(url);
  if (pageUrl === null) return { status: "no-url" };
  const subject: Subject = {
    kind: "channel",
    platform: "youtube",
    registrable: new URL(pageUrl).pathname.split("/").filter(Boolean).join(":").toLowerCase(),
    url: pageUrl,
  };
  try {
    const found = await cachedProbe(subject, "youtube-channel", {
      schema: cachedChannel,
      run: () => readYoutubeChannelPage(pageUrl),
    });
    return { status: "id", channelId: found.channelId };
  } catch (error) {
    if (error instanceof YoutubePageMiss) return { status: "unresolved", reason: error.message };
    throw error;
  }
}
