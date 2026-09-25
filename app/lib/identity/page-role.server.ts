import { z } from "zod";

import { insertVerdicts, type VerdictRow } from "../data/jev_verdict.server";
import { readPageHashes, upsertJudgedPages, type JudgedPage } from "../data/page.server";
import { askChoice, type ChoiceQuestion } from "../jev/client.server";

export interface NavPage {
  url: string;
  title: string;
}

export const PAGE_ROLE: ChoiceQuestion = {
  id: "page_role",
  instructions: "What is item for on the site of subject? Judge by what the page is for, not by the words in its URL.",
  options: {
    home: "the site's front page",
    pricing: "plans, prices, or the full catalogue a buyer compares prices on",
    product: "a single product or product line",
    blog: "articles, news or journal posts",
    careers: "jobs or working at the company",
    legal: "terms, privacy, cookies or returns policy",
    other: "anything else",
  },
};

const pageRole = z.enum(["home", "pricing", "product", "blog", "careers", "legal", "other"]);

async function pageHash(page: NavPage): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ url: page.url, title: page.title })),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function classifyNavPages(
  workspaceId: string,
  entity: { id: string; domain: string },
  pages: readonly NavPage[],
  now: string,
): Promise<readonly JudgedPage[]> {
  const hashes = await readPageHashes(entity.id);
  const targets = await Promise.all(pages.map(async (page) => ({ page, hash: await pageHash(page) })));
  const stale = targets.filter((target) => hashes.get(target.page.url) !== target.hash);
  if (stale.length === 0) return [];

  const verdicts = await Promise.all(
    stale.map(({ page }) =>
      askChoice(workspaceId, PAGE_ROLE, {
        subject: { domain: entity.domain },
        item: { url: page.url, title: page.title },
      }),
    ),
  );

  const rows: JudgedPage[] = stale.map(({ page, hash }, index) => ({
    id: crypto.randomUUID(),
    entityId: entity.id,
    url: page.url,
    title: page.title,
    role: pageRole.parse(verdicts[index]?.choice),
    roleDecidedForHash: hash,
    discoveredAt: now,
  }));

  const verdictRows: VerdictRow[] = verdicts.flatMap((verdict) =>
    verdict.cached
      ? []
      : [
          {
            workspaceId,
            questionId: verdict.questionId,
            inputHash: verdict.inputHash,
            signalId: null,
            entityId: entity.id,
            p: null,
            choice: verdict.choice,
            reason: null,
            decidedAt: now,
          },
        ],
  );

  await insertVerdicts(verdictRows);
  await upsertJudgedPages(rows);
  return rows;
}
