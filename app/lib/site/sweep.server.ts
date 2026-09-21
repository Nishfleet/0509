/**
 * The site-change engine, per watch per tick.
 *
 * Order is load-bearing: capture -> extract -> hash gate -> (baseline |
 * unchanged | changed). A changed page is judged BEFORE its snapshot row is
 * written, so a Jev failure leaves the previous snapshot in place and the
 * Workflow retry re-runs the same diff against the same stored baseline —
 * an unreviewed item is never dropped. Screenshots and the R2 evidence pair
 * are paid for only on baseline and on a real content change.
 */
import {
  browserBudgetRemainingMs,
  capturePageHtml,
  capturePageScreenshot,
  consumeBrowserMs,
  type BrowserEnv,
} from "./browser.server";
import { buildContextPack } from "./context.server";
import { diffSiteText, type SiteTextDiff } from "./diff";
import {
  canonicalPageText,
  extractPage,
  sameOriginLinks,
  type ExtractedPage,
} from "./extract.server";
import { jevDecide, type JevEnv } from "./jev.server";
import { sha256Hex } from "../hash";
import { insertAlert } from "../data/alert.server";
import { getEntity, type DataEnv, type EntityRow } from "../data/entity.server";
import {
  closeIncident,
  openIncident,
  openIncidentForPage,
  recordIncidentNotice,
  rescindIncidentNotice,
} from "../data/incident.server";
import { findVerdict, insertVerdict } from "../data/jev-verdict.server";
import {
  listPagesForEntity,
  setPageRole,
  setPageTitle,
  upsertPage,
  type PageRow,
} from "../data/page.server";
import {
  insertSnapshot,
  latestSnapshotForPage,
  readSnapshotPayload,
  snapshotPayloadKey,
  writeSnapshotPayload,
  type SnapshotEnv,
  type SnapshotPayload,
} from "../data/snapshot.server";
import { insertSignal } from "../data/signal.server";
import { getSiteWatch, touchWatch, type WatchRow } from "../data/watch.server";
import { getOwnerEmail } from "../data/workspace.server";

export interface SweepEnv extends DataEnv, BrowserEnv, JevEnv, SnapshotEnv {
  EMAIL?: { send(message: unknown): Promise<unknown> };
  ENGINE_TELEMETRY?: {
    writeDataPoint(point: {
      blobs?: string[];
      doubles?: number[];
      indexes?: string[];
    }): void;
  };
}

const ESTIMATED_PAGE_MS = 4000;
const MAX_PAGES_PER_SWEEP = 5;

const CHANGE_KINDS: Record<string, string> = {
  offer: "a discount, promotion or special offer appeared or changed",
  pricing: "prices, plans or packaging changed",
  copy: "messaging, headlines or positioning changed",
  launch: "a new product, feature or page appeared",
  removal: "something was removed",
  breakage: "the page looks broken or unintended",
  unintended: "a change that looks accidental rather than deliberate",
  noise: "cosmetic churn not worth telling the user about",
};

const PAGE_ROLES: Record<string, string> = {
  home: "the brand's homepage",
  pricing: "plans, prices, membership or tariffs",
  product: "a product or collection page",
  blog: "articles, news or journal",
  careers: "jobs or hiring",
  legal: "terms, privacy or policy",
  other: "none of those",
};

interface WatchContext {
  watch: WatchRow;
  entity: EntityRow;
  reliability: string;
}

export interface PageResult {
  page_id: string;
  url: string;
  result: string;
  snapshot_id?: string;
  signal_id?: string;
  verdict_p?: number | null;
  discovered?: string[];
}

export async function sweepWatch(
  env: SweepEnv,
  watchId: string,
): Promise<{ watch_id: string; pages: PageResult[] }> {
  const joined = await getSiteWatch(env, watchId);
  if (!joined) return { watch_id: watchId, pages: [] };
  const entity = await getEntity(env, joined.entity_id);
  if (!entity) return { watch_id: watchId, pages: [] };
  const ctx: WatchContext = {
    watch: {
      id: joined.id,
      entity_id: joined.entity_id,
      source_id: joined.source_id,
      target_key: joined.target_key,
      cursor: joined.cursor,
      last_polled_at: joined.last_polled_at,
    },
    entity,
    reliability: joined.source_reliability,
  };

  let pages = await listPagesForEntity(env, entity.id);
  if (pages.length === 0) {
    const home = await upsertPage(
      env,
      entity.id,
      normalizeHome(ctx.watch.target_key, entity.domain),
    );
    pages = [home];
  }

  const results: PageResult[] = [];
  const queue = prioritize(pages);
  while (results.length < MAX_PAGES_PER_SWEEP) {
    const page = queue.shift();
    if (!page) break;
    const remaining = await browserBudgetRemainingMs(env, entity.id);
    if (remaining < ESTIMATED_PAGE_MS) {
      results.push({
        page_id: page.id,
        url: page.url,
        result: "deferred-budget",
      });
      continue;
    }
    const result = await processPage(env, ctx, page);
    results.push(result);
    const isHome = page.role === "home" || pages.length === 1;
    if (isHome && result.discovered?.length) {
      const existing = new Set(
        (await listPagesForEntity(env, entity.id)).map((p) => p.url),
      );
      for (const url of result.discovered) {
        if (existing.has(url)) continue;
        const fresh = await upsertPage(env, entity.id, url);
        existing.add(url);
        queue.push(fresh);
      }
    }
  }

  await touchWatch(env, watchId);
  return { watch_id: watchId, pages: results };
}

function normalizeHome(targetKey: string, domain: string): string {
  const raw = targetKey || domain;
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}/`;
}

function prioritize(pages: PageRow[]): PageRow[] {
  const rank = (p: PageRow) =>
    p.role === "home"
      ? 0
      : p.role === "pricing"
        ? 1
        : p.role === null
          ? 2
          : 3;
  return [...pages].sort((a, b) => rank(a) - rank(b));
}

async function processPage(
  env: SweepEnv,
  ctx: WatchContext,
  page: PageRow,
): Promise<PageResult> {
  const { entity, watch } = ctx;
  const cap = await capturePageHtml(env, page.url);
  await consumeBrowserMs(env, entity.id, cap.browserMs);
  const extracted = await extractPage(cap.html);
  const canonical = canonicalPageText(extracted);
  const hash = await sha256Hex(canonical);
  if (extracted.title && extracted.title !== page.title)
    await setPageTitle(env, page.id, extracted.title);

  const role = await ensurePageRole(env, ctx, page, extracted, canonical);
  const prev = await latestSnapshotForPage(env, page.id);
  const changed = prev !== null && prev.payload_hash !== hash;
  const discovered = page.role === "home" || page.role === null
    ? sameOriginLinks(extracted, page.url)
    : [];

  if (prev && !changed) {
    const snapshot_id = await writeSnapshot(
      env, ctx, page, canonical, extracted, cap.html, hash, null,
    );
    return { page_id: page.id, url: page.url, result: "unchanged", snapshot_id, discovered };
  }

  const judgment = prev
    ? await judgeChange(env, ctx, page, role, canonical, prev)
    : null;

  const shotKey = await browserScreenshotWithinBudget(env, entity.id, page.url);
  const snapshot_id = await writeSnapshot(
    env, ctx, page, canonical, extracted, cap.html, hash, shotKey,
  );

  if (!prev)
    return { page_id: page.id, url: page.url, result: "baseline", snapshot_id, discovered };

  const result: PageResult = {
    page_id: page.id,
    url: page.url,
    result: "changed",
    snapshot_id,
    verdict_p: judgment?.p ?? null,
    discovered,
  };
  if (judgment && judgment.p !== null && judgment.p > 0.1) {
    result.signal_id = await insertSignal(env, {
      workspace_id: entity.workspace_id,
      entity_id: entity.id,
      source_id: watch.source_id,
      watch_id: watch.id,
      snapshot_id,
      kind: "change",
      aspect: judgment.kind ?? "unreviewed",
      title: `${entity.name ?? entity.domain}: ${role ?? "page"} change`,
      summary: `+${String(judgment.diff.added)}/-${String(judgment.diff.removed)} lines on ${page.url}`,
      url: page.url,
      dedup_key: await sha256Hex(
        `${watch.id}:${page.id}:${judgment.inputHash}`,
      ),
      payload: {
        jev_p: judgment.p,
        verdict: judgment.p >= 0.9 ? "published" : "uncertain",
        diff_excerpt: judgment.diff.excerpt,
        page_id: page.id,
        before_snapshot_id: prev.id,
        before_screenshot_key: prev.payload_r2_key
          ? ((await readSnapshotPayload(env, prev.payload_r2_key))
              ?.screenshot_key ?? null)
          : null,
        after_screenshot_key: shotKey,
      },
    });
  }
  return result;
}

async function writeSnapshot(
  env: SweepEnv,
  ctx: WatchContext,
  page: PageRow,
  canonical: string,
  extracted: ExtractedPage,
  html: string,
  hash: string,
  screenshotKey: string | null,
): Promise<string> {
  const snapshotId = crypto.randomUUID();
  const key = snapshotPayloadKey(ctx.entity.id, page.id, snapshotId);
  const payload: SnapshotPayload = {
    url: page.url,
    fetched_at: new Date().toISOString(),
    text: canonical,
    fields: {
      title: extracted.title,
      description: extracted.description,
      headings: extracted.headings,
      prices: extracted.prices,
      ctas: extracted.ctas,
    },
    html,
    screenshot_key: screenshotKey,
  };
  await writeSnapshotPayload(env, key, payload);
  await insertSnapshot(env, {
    id: snapshotId,
    watch_id: ctx.watch.id,
    page_id: page.id,
    payload_r2_key: key,
    payload_hash: hash,
    item_count:
      extracted.headings.length + extracted.prices.length + extracted.ctas.length,
  });
  return snapshotId;
}

async function ensurePageRole(
  env: SweepEnv,
  ctx: WatchContext,
  page: PageRow,
  extracted: ExtractedPage,
  canonical: string,
): Promise<string | null> {
  const roleHash = await sha256Hex(`${page.url}\n${extracted.title}`);
  if (page.role && page.role_decided_for_hash === roleHash) return page.role;
  const questionId = "page_role";
  const inputHash = await sha256Hex(
    JSON.stringify({ q: questionId, url: page.url, title: extracted.title }),
  );
  const cached = await findVerdict(env, questionId, inputHash);
  let role = cached?.choice ?? null;
  if (!role) {
    const answers = await jevDecide(
      env,
      {
        url: page.url,
        title: extracted.title,
        excerpt: canonical.slice(0, 1500),
        brand: ctx.entity.domain,
      },
      {
        [questionId]: {
          type: "choice",
          instructions: "What role does this page play for the brand?",
          criteria: PAGE_ROLES,
        },
      },
    );
    role = answers[questionId]?.choice ?? null;
    await insertVerdict(env, {
      workspace_id: ctx.entity.workspace_id,
      question_id: questionId,
      input_hash: inputHash,
      entity_id: ctx.entity.id,
      choice: role,
      p: role ? (answers[questionId]?.probabilities?.[role] ?? null) : null,
    });
  }
  if (role && PAGE_ROLES[role])
    await setPageRole(env, page.id, extracted.title, role, roleHash);
  return role ?? page.role;
}

async function browserScreenshotWithinBudget(
  env: SweepEnv,
  entityId: string,
  url: string,
): Promise<string | null> {
  const remaining = await browserBudgetRemainingMs(env, entityId);
  if (remaining < ESTIMATED_PAGE_MS) return null;
  const shot = await capturePageScreenshot(env, url);
  await consumeBrowserMs(env, entityId, shot.browserMs);
  const key = `site-shots/${entityId}/${crypto.randomUUID()}.png`;
  await env.SNAPSHOTS.put(key, shot.png, {
    httpMetadata: { contentType: "image/png" },
  });
  return key;
}

async function judgeChange(
  env: SweepEnv,
  ctx: WatchContext,
  page: PageRow,
  role: string | null,
  canonical: string,
  prev: { payload_r2_key: string | null },
): Promise<{ p: number | null; kind: string | null; diff: SiteTextDiff; inputHash: string } | null> {
  const { entity } = ctx;
  const prevPayload = prev.payload_r2_key
    ? await readSnapshotPayload(env, prev.payload_r2_key)
    : null;
  const diff = diffSiteText(prevPayload?.text ?? "", canonical);
  const item = {
    type: "site_change",
    page_url: page.url,
    page_role: role ?? "unknown",
    added_lines: diff.added,
    removed_lines: diff.removed,
    diff_excerpt: diff.excerpt,
  };
  const pack = await buildContextPack(env, entity, item, ctx.reliability);

  if (entity.role === "self") await judgeBreakage(env, ctx, page, pack);

  const questionId = "noteworthy_change";
  const inputHash = await sha256Hex(JSON.stringify({ q: questionId, pack }));
  const cached = await findVerdict(env, questionId, inputHash);
  let p = cached?.p ?? null;
  let kind = cached?.choice ?? null;
  if (!cached) {
    const answers = await jevDecide(env, pack, {
      [questionId]: {
        type: "boolean",
        instructions:
          "Is this diff on the subject's page worth telling the user? Answer for a competitor-watch product: meaningful commercial or messaging movement is noteworthy; churn like rotating hero art is not.",
      },
      change_kind: {
        type: "choice",
        instructions: "What kind of change is this?",
        criteria: CHANGE_KINDS,
      },
    });
    p = answers[questionId]?.probability ?? null;
    kind = answers.change_kind?.choice ?? null;
    await insertVerdict(env, {
      workspace_id: entity.workspace_id,
      question_id: questionId,
      input_hash: inputHash,
      entity_id: entity.id,
      p,
      choice: kind,
    });
  }
  return { p, kind, diff, inputHash };
}

async function judgeBreakage(
  env: SweepEnv,
  ctx: WatchContext,
  page: PageRow,
  pack: Record<string, unknown>,
): Promise<void> {
  const { entity } = ctx;
  const questionId = "own_site_breakage";
  const inputHash = await sha256Hex(JSON.stringify({ q: questionId, pack }));
  const cached = await findVerdict(env, questionId, inputHash);
  let p = cached?.p ?? null;
  if (!cached) {
    const answers = await jevDecide(env, pack, {
      [questionId]: {
        type: "boolean",
        instructions:
          "This is the user's OWN site. Does this diff look broken or unintended rather than deliberate? Sections gone, prices empty, layout collapsed, error text — those are breakage. A deliberate copy or price edit is not.",
      },
    });
    p = answers[questionId]?.probability ?? null;
    await insertVerdict(env, {
      workspace_id: entity.workspace_id,
      question_id: questionId,
      input_hash: inputHash,
      entity_id: entity.id,
      p,
    });
  }
  if (p === null) return;
  if (p >= 0.5) {
    const incident = await openIncident(env, {
      workspace_id: entity.workspace_id,
      entity_id: entity.id,
      page_id: page.id,
      kind: "looks_broken",
    });
    await insertAlert(env, {
      workspace_id: entity.workspace_id,
      entity_id: entity.id,
      page_id: page.id,
      incident_id: incident.id,
      kind: "breakage",
      severity: "high",
      title: `${entity.name ?? entity.domain} looks broken`,
      body: `Jev own_site_breakage p=${String(p)} on ${page.url}`,
    });
    await notifyIncidentOnce(env, ctx, page, incident.id, p);
  } else {
    if (p >= 0.1) {
      await insertAlert(env, {
        workspace_id: entity.workspace_id,
        entity_id: entity.id,
        page_id: page.id,
        kind: "check",
        severity: "normal",
        title: `Check ${entity.name ?? entity.domain}`,
        body: `Possible unintended change on ${page.url} (p=${String(p)})`,
      });
      return;
    }
    const open = await openIncidentForPage(env, page.id);
    if (open) {
      await closeIncident(env, open.id);
      await insertAlert(env, {
        workspace_id: entity.workspace_id,
        entity_id: entity.id,
        page_id: page.id,
        incident_id: open.id,
        kind: "resolved",
        severity: "normal",
        title: `${entity.name ?? entity.domain} recovered`,
        body: `Incident ${open.id} closed: fresh capture on ${page.url} judged not-broken (p=${String(p)})`,
      });
    }
  }
}

async function notifyIncidentOnce(
  env: SweepEnv,
  ctx: WatchContext,
  page: PageRow,
  incidentId: string,
  p: number,
): Promise<void> {
  const noticeId = await recordIncidentNotice(env, {
    incident_id: incidentId,
    page_id: page.id,
    is_resolution: false,
  });
  if (!noticeId || !env.EMAIL) return;
  const to = await getOwnerEmail(env, ctx.entity.workspace_id);
  if (!to) return;
  try {
    await env.EMAIL.send({
      to,
      from: { email: "hello@0509.io", name: "Five to Nine" },
      subject: `${ctx.entity.name ?? ctx.entity.domain} looks broken`,
      text: `Your tracked page ${page.url} looks broken (p=${String(p)}). Open https://0509.io/app/alerts to review.`,
    });
  } catch {
    await rescindIncidentNotice(env, noticeId);
  }
}

export async function recordWatchFailure(
  env: SweepEnv,
  watchId: string,
  error: unknown,
): Promise<void> {
  const joined = await getSiteWatch(env, watchId);
  if (!joined) return;
  const entity = await getEntity(env, joined.entity_id);
  if (entity?.role !== "self") return;
  const pages = await listPagesForEntity(env, entity.id);
  const page = pages.find((p) => p.role === "home") ?? pages[0];
  if (!page) return;
  const incident = await openIncident(env, {
    workspace_id: entity.workspace_id,
    entity_id: entity.id,
    page_id: page.id,
    kind: "capture_failed",
  });
  await insertAlert(env, {
    workspace_id: entity.workspace_id,
    entity_id: entity.id,
    page_id: page.id,
    incident_id: incident.id,
    kind: "breakage",
    severity: "high",
    title: `${entity.name ?? entity.domain} unreachable`,
    body: `Capture failed after step retries: ${String(error).slice(0, 300)}`,
  });
  env.ENGINE_TELEMETRY?.writeDataPoint({
    blobs: ["watch_failed", entity.id],
    doubles: [1],
    indexes: ["site-sweep"],
  });
}
