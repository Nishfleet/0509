import { z } from "zod";

import { insertVerdicts, type VerdictRow } from "../data/jev_verdict.server";
import { readPageHashes, upsertJudgedPages, type JudgedPage } from "../data/page.server";
import { askChoices, type ChoiceQuestion, type ChoiceVerdict } from "../jev/client.server";
import { sha256Hex } from "../sha256";

const NAV_PAGES_JUDGED = 40;

const PRICING_LOOKING = /pric|plans?\b|packages?\b|subscri|buy|shop|store|catalog/i;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function pricingLookingFirst(pages: readonly NavPage[]): NavPage[] {
  const looks = (page: NavPage) => PRICING_LOOKING.test(`${pathOf(page.url)} ${page.title}`);
  return [...pages.filter(looks), ...pages.filter((page) => !looks(page))];
}

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

export function pageRoleState(domain: string, page: NavPage): Record<string, unknown> {
  return { subject: { domain }, item: { url: page.url, title: page.title } };
}

async function pageHash(page: NavPage): Promise<string> {
  return sha256Hex(JSON.stringify({ url: page.url, title: page.title }));
}

export interface ClassifyNavPagesInput {
  workspaceId: string;
  entity: { id: string; domain: string };
  pages: readonly NavPage[];
  now: string;
}

interface Target {
  page: NavPage;
  hash: string;
}

async function judgeStale(
  workspaceId: string,
  domain: string,
  stale: readonly Target[],
): Promise<(Target & { verdict: ChoiceVerdict })[]> {
  const settled = await askChoices(
    workspaceId,
    PAGE_ROLE,
    stale.map(({ page }) => pageRoleState(domain, page)),
  );
  const judged = stale.flatMap((target, index) => {
    const result = settled[index];
    return result?.status === "fulfilled" ? [{ ...target, verdict: result.value }] : [];
  });
  const refusal = settled.find((result) => result.status === "rejected");
  if (judged.length === 0 && refusal?.status === "rejected") throw refusal.reason;
  return judged;
}

export async function classifyNavPages({
  workspaceId,
  entity,
  pages,
  now,
}: ClassifyNavPagesInput): Promise<readonly JudgedPage[]> {
  const hashes = await readPageHashes(entity.id);
  const targets = await Promise.all(
    pricingLookingFirst(pages)
      .slice(0, NAV_PAGES_JUDGED)
      .map(async (page) => ({ page, hash: await pageHash(page) })),
  );
  const stale = targets.filter((target) => hashes.get(target.page.url) !== target.hash);
  if (stale.length === 0) return [];

  const judged = await judgeStale(workspaceId, entity.domain, stale);
  const verdicts = judged.map((entry) => entry.verdict);

  const rows: JudgedPage[] = judged.map(({ page, hash, verdict }) => ({
    id: crypto.randomUUID(),
    entityId: entity.id,
    url: page.url,
    title: page.title,
    role: pageRole.parse(verdict.choice),
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
