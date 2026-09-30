import { getDomain } from "tldts";
import { z } from "zod";

import type { HiringTarget } from "../data/watch.server";
import { insertWatches, readEntitiesWithoutHiringWatch, readHiringTargets } from "../data/watch.server";
import { readEnabledSourceId } from "../data/source.server";
import { readThrough } from "../identity/probe-cache.server";
import { readUrl } from "../fetch/transport.server";
import { discoverBoard } from "./discover-board.server";
import type { DiscoveredBoard } from "./discover-board.server";

const BOARD_SCHEMA = z.object({
  platform: z.enum(["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "none"]),
  boardUrl: z.string().nullable(),
});

const BOARD_TTL_SECONDS = 604_800;

function resolveLink(href: string, base: string): string | null {
  return URL.canParse(href, base) ? new URL(href, base).href : null;
}

async function homepageLinks(html: string, base: string): Promise<string[]> {
  const hrefs: string[] = [];
  const rewritten = new HTMLRewriter()
    .on("a[href]", {
      element(el) {
        const href = el.getAttribute("href");
        if (href !== null) hrefs.push(href);
      },
    })
    .transform(new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } }));

  await rewritten.arrayBuffer();

  const links = hrefs.map((href) => resolveLink(href, base));
  return [...new Set(links.filter((link) => link !== null))];
}

class HomepageDeferredError extends Error {}

export interface FoundBoard {
  entityId: string;
  platform: DiscoveredBoard["platform"];
  boardUrl: string | null;
  watched: boolean;
}

export async function planHiringSweep(): Promise<{
  entities: readonly { id: string; domain: string }[];
  targets: readonly HiringTarget[];
}> {
  return { entities: await readEntitiesWithoutHiringWatch(), targets: await readHiringTargets() };
}

async function readBoardThrough(
  domain: string,
  registrable: string,
  homepage: string,
): Promise<z.infer<typeof BOARD_SCHEMA> | null> {
  try {
    return await readThrough(`hiring:${registrable}:board`, BOARD_SCHEMA, BOARD_TTL_SECONDS, async () => {
      const page = await readUrl(homepage);
      if (!page.ok) {
        throw page.reason === "deferred"
          ? new HomepageDeferredError(domain)
          : new Error(`hiring.homepage_unreadable ${domain}: ${page.reason}`);
      }
      const found = await discoverBoard(await homepageLinks(page.html, homepage), domain);
      return { platform: found.platform, boardUrl: found.boardUrl };
    });
  } catch (error) {
    if (error instanceof HomepageDeferredError) return null;
    throw error;
  }
}

export async function findBoard(entity: { id: string; domain: string }): Promise<FoundBoard> {
  const registrable = getDomain(entity.domain);
  if (registrable === null || registrable !== entity.domain) {
    return { entityId: entity.id, platform: "none", boardUrl: null, watched: false };
  }

  const homepage = `https://${entity.domain}/`;
  const board = await readBoardThrough(entity.domain, registrable, homepage);
  if (board === null) return { entityId: entity.id, platform: "none", boardUrl: null, watched: false };

  const base = { entityId: entity.id, platform: board.platform, boardUrl: board.boardUrl };

  if (board.boardUrl === null) return { ...base, watched: false };

  const sourceId = await readEnabledSourceId(`hiring.${board.platform}`);
  if (sourceId === null) return { ...base, watched: false };

  await insertWatches([{ id: crypto.randomUUID(), entityId: entity.id, sourceId, targetKey: board.boardUrl }]);
  return { ...base, watched: true };
}
