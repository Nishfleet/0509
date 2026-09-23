import { env } from "cloudflare:workers";
import { z } from "zod";

import { selfEntityIdForDomain, upsertSelfEntityStmt } from "../data/entity.server";
import { insertVerdictStmt } from "../data/jev-verdict.server";
import { insertOnboardingRunStmt } from "../data/onboarding-run.server";
import { insertHomePageStmt, insertRolePageStmt } from "../data/page.server";
import { takedownSubjectsPresent } from "../data/takedown.server";
import { priorRefusalExists, userDecisionStmts } from "../data/user-decision.server";
import { probeFetch, readJson, readUrl, ReadUrlResultSchema, type ReadUrlResult } from "../fetch/transport.server";
import { jevAsk, jevConfig, type JevQuestion } from "../jev/client";
import { buildIdentityPack, inputHash } from "../jev/context-pack";
import type { CardField, CardResult } from "./card-types";
import { extract, type Extracted } from "./extract";
import { logoCandidates, LogoResolutionSchema, resolveLogo } from "./logo-cascade";
import { NormalisedSubject, normaliseInput } from "./normalise";
import { probeThrough } from "./probe-cache";

interface CardDeps {
  db: D1Database;
  cache?: KVNamespace;
  jev?: { url: string; apiKey?: string };
}

const D7_FIELDS = ["name", "logo", "description", "category", "country", "socials"] as const;
const PAGE_ROLES = { home: "", pricing: "", product: "", blog: "", careers: "", legal: "", other: "" } as const;
const NAV_JUDGED = 10;
const REFUSAL_LINE = "we track brands and creators, not people";

function id(): string {
  return crypto.randomUUID();
}

interface ProbeFailure {
  leg: string;
  reason: string;
}

async function probe<T>(
  leg: string,
  fn: () => Promise<T>,
  failures: ProbeFailure[],
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "failed";
    failures.push({ leg, reason });
    return { ok: false, reason };
  }
}

const WdClaims = z.record(
  z.string(),
  z
    .array(z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }) }))
    .optional(),
);
const WdSearch = z.object({ search: z.array(z.object({ id: z.string() })).optional() });
const WdEntityValue = z.object({ id: z.string(), "entity-type": z.string().optional() });
const WdLabels = z.object({
  entities: z
    .record(z.string(), z.object({ labels: z.record(z.string(), z.object({ value: z.string() })).optional() }))
    .optional(),
});

async function wikidataLabel(qid: string): Promise<string | null> {
  const body = WdLabels.parse(
    await readJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=en&format=json`,
    ),
  );
  return body.entities?.[qid]?.labels?.en?.value ?? null;
}

const WdResult = z.object({
  qid: z.string(),
  claims: WdClaims,
  country: z.string().nullable(),
});
const WdCachedResult = WdResult.nullable();

async function wikidata(
  name: string,
  failures: ProbeFailure[],
): Promise<{ qid: string; claims: z.infer<typeof WdClaims>; country: string | null } | null> {
  const hits = WdSearch.parse(
    await readJson(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=1`,
    ),
  );
  const qid = hits.search?.[0]?.id;
  if (!qid) return null;
  const body = z
    .object({ entities: z.record(z.string(), z.object({ claims: WdClaims })).optional() })
    .parse(
      await readJson(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`,
      ),
    );
  const claims = body.entities?.[qid]?.claims ?? {};
  const p17 = WdEntityValue.safeParse(claims.P17?.[0]?.mainsnak?.datavalue?.value);
  let country: string | null = null;
  if (p17.success && p17.data["entity-type"] === "item") {
    const label = await probe("wikidata-label", () => wikidataLabel(p17.data.id), failures);
    country = label.ok ? label.value : null;
  }
  return { qid, claims, country };
}

function iconArea(sizes: string | undefined): number {
  if (!sizes) return 0;
  if (sizes.trim() === "any") return Number.MAX_SAFE_INTEGER;
  let best = 0;
  for (const token of sizes.split(/\s+/)) {
    const [w, h] = token.split("x").map(Number);
    if (Number.isFinite(w) && Number.isFinite(h)) best = Math.max(best, w * h);
  }
  return best;
}

async function recordRefusal(
  deps: CardDeps,
  args: { workspaceId: string; userId: string; input: string },
  verdict: string,
  note: string,
  verdictRow?: { p: number | null; reason: string | null; inputHash: string },
): Promise<void> {
  const stmts: D1PreparedStatement[] = userDecisionStmts(deps.db, [
    { workspaceId: args.workspaceId, userId: args.userId, verdict, note },
  ]);
  if (verdictRow) {
    stmts.unshift(
      insertVerdictStmt(deps.db, {
        id: id(),
        workspaceId: args.workspaceId,
        questionId: "public_subject",
        inputHash: verdictRow.inputHash,
        entityId: null,
        p: verdictRow.p,
        choice: null,
        reason: verdictRow.reason,
        now: new Date().toISOString(),
      }),
    );
  }
  await deps.db.batch(stmts);
}

export async function buildIdentityCard(
  deps: CardDeps,
  args: { workspaceId: string; userId: string; input: string; onboardingRunId?: string },
): Promise<CardResult> {
  const norm = normaliseInput(args.input);
  if (!norm.ok) return { ok: false, reason: norm.reason };
  const subject = norm.subject;

  const refusalKey = subject.registrable ?? subject.handle ?? args.input;
  if (await priorRefusalExists(deps.db, args.workspaceId, refusalKey)) {
    return { ok: false, reason: REFUSAL_LINE };
  }

  const subjects = [subject.registrable, subject.handle && `${subject.platform ?? "*"}:${subject.handle}`].filter(
    (s): s is string => Boolean(s),
  );
  const taken = await takedownSubjectsPresent(deps.db, subjects);
  if (taken.length) {
    await recordRefusal(deps, args, "refused:takedown", refusalKey);
    return { ok: false, reason: REFUSAL_LINE };
  }

  const cacheKey = subject.registrable ?? subject.handle ?? subject.input;
  const cache = deps.cache;

  const probeFailures: ProbeFailure[] = [];

  const pageUrl = subject.url;
  const homepage: ReadUrlResult = pageUrl
    ? await probeThrough(
        cache,
        cacheKey,
        "homepage",
        () => readUrl(pageUrl),
        ReadUrlResultSchema,
        (v) => v.ok,
      )
    : { ok: false, reason: "invalid-url", detail: "no homepage URL for this input" };
  if (!homepage.ok) probeFailures.push({ leg: "homepage", reason: `${homepage.reason}: ${homepage.detail}` });

  const html = homepage.ok ? homepage.html : null;
  const extractedRes = html && pageUrl ? await probe("extract", () => extract(html, pageUrl), probeFailures) : null;
  const extracted: Extracted | null = extractedRes?.ok ? extractedRes.value : null;

  const manifestHref = extracted?.manifestHref ?? null;
  const fetchManifestIcons = async (): Promise<string[]> => {
    if (!manifestHref) return [];
    const body = z
      .object({ icons: z.array(z.object({ src: z.string(), sizes: z.string().optional() })).optional() })
      .parse(await readJson(manifestHref));
    return (body.icons ?? [])
      .map((i) => ({ url: new URL(i.src, manifestHref).toString(), area: iconArea(i.sizes) }))
      .sort((a, b) => b.area - a.area)
      .map((i) => i.url);
  };

  const candidateName = extracted?.name ?? subject.handle ?? subject.registrable ?? null;
  const wdName = candidateName ?? subject.registrable;
  const wdP = wdName
    ? probe("wikidata", () =>
        probeThrough(cache, cacheKey, "wikidata", () => wikidata(wdName, probeFailures), WdCachedResult), probeFailures)
    : Promise.resolve(null);

  const [manifestIcons, wd] = await Promise.all([
    probe("manifest", fetchManifestIcons, probeFailures),
    wdP,
  ]);

  const logoP = extracted && pageUrl
    ? probe("logo", () =>
        probeThrough(cache, cacheKey, "logo", () =>
          resolveLogo(logoCandidates(pageUrl, extracted, manifestIcons.ok ? manifestIcons.value : []), probeFetch),
          LogoResolutionSchema,
        ), probeFailures)
    : Promise.resolve(null);

  const logoRes = await logoP;
  const logo = logoRes?.ok ? logoRes.value.hit : null;
  if (logoRes?.ok && !logoRes.value.hit && logoRes.value.misses.length) {
    const summary = logoRes.value.misses
      .slice(0, 4)
      .map((m) => `${m.via}: ${m.reason}`)
      .join("; ");
    probeFailures.push({
      leg: "logo",
      reason: `${String(logoRes.value.misses.length)} candidates missed — ${summary}${logoRes.value.misses.length > 4 ? "; …" : ""}`,
    });
  }

  const fields: Record<string, { value: unknown; via: string }> = {};
  const put = (name: string, value: unknown, via: string) => {
    if (value !== null && value !== undefined && value !== "") fields[name] = { value, via };
  };
  put("name", candidateName, extracted?.ldOrganization ? "ld+json" : extracted ? "meta" : "input");
  put("logo", logo?.url ?? extracted?.logoUrl, logo ? `logo-cascade:${logo.via}` : extracted ? "ld+json|og" : "");
  put("description", extracted?.description, "meta");
  put("country", wd?.ok ? (wd.value?.country ?? null) : null, "wikidata");
  put("socials", extracted?.socials.length ? extracted.socials : null, "ld+json+links");

  const pack = buildIdentityPack({
    raw: args.input,
    kind: subject.kind,
    registrable: subject.registrable,
    platform: subject.platform ?? null,
    fields,
    reliability: { homepage: "scraped_page", wikidata: "official_api", nav: "scraped_page" },
  });
  const packHash = await inputHash(pack);

  const seenHrefs = new Set<string>();
  const judgedLinks: { href: string; text: string; roleHash: string }[] = [];
  for (const l of extracted?.navLinks ?? []) {
    if (seenHrefs.has(l.href) || judgedLinks.length >= NAV_JUDGED) continue;
    seenHrefs.add(l.href);
    judgedLinks.push({ href: l.href, text: l.text, roleHash: "" });
  }
  for (const link of judgedLinks) {
    link.roleHash = await inputHash({ url: link.href, title: link.text });
  }

  const questions: Record<string, JevQuestion> = {
    public_subject: {
      type: "boolean",
      instructions: "Is this input a brand, company or public creator — a public subject we may track — and not a private person?",
    },
  };
  for (const f of D7_FIELDS) {
    if (fields[f]) {
      questions[`d7_${f}`] = {
        type: "boolean",
        instructions: `Is this extracted ${f} value right for this brand's card? Answer for the value in item.${f}.`,
      };
    }
  }
  for (const link of judgedLinks) {
    questions[`d9_${link.href}`] = {
      type: "choice",
      instructions: `What role does this page play for the subject: ${link.href} (${link.text})?`,
      criteria: { ...PAGE_ROLES },
    };
  }

  const jev = deps.jev
    ? await jevAsk(deps.jev, pack, questions)
    : ({ ok: false, reason: "jev-unconfigured", ms: 0 } as const);

  const publicP = jev.ok ? jev.answers.public_subject?.probability : undefined;
  if (publicP !== undefined && publicP < 0.1) {
    await recordRefusal(deps, args, "refused:public_subject", refusalKey, {
      p: publicP,
      reason: jev.ok ? (jev.answers.public_subject?.reason ?? null) : null,
      inputHash: packHash,
    });
    return { ok: false, reason: REFUSAL_LINE };
  }
  const publicSubject =
    jev.ok && publicP !== undefined ? (publicP >= 0.9 ? "cleared" : "ask") : "unverified";

  const cardFields: CardField[] = [];
  const verdictRows: {
    question_id: string;
    input_hash: string;
    p: number | null;
    choice: string | null;
    reason: string | null;
  }[] = [];
  for (const f of D7_FIELDS) {
    const field = fields[f];
    const ans = jev.ok ? jev.answers[`d7_${f}`] : undefined;
    const p = ans?.probability;
    if (jev.ok) {
      verdictRows.push({ question_id: `d7_${f}`, input_hash: packHash, p: p ?? null, choice: null, reason: ans?.reason ?? null });
    }
    if (!field) {
      cardFields.push({ name: f, value: null, state: "empty", via: "", reason: "we'll fill this after the first crawl" });
    } else if (p === undefined) {
      cardFields.push({ name: f, value: String(field.value), state: "check", via: field.via, reason: "unreviewed" });
    } else if (p >= 0.9) {
      cardFields.push({ name: f, value: String(field.value), state: "filled", via: field.via });
    } else if (p <= 0.1) {
      cardFields.push({ name: f, value: null, state: "empty", via: field.via, reason: "we'll fill this after the first crawl" });
    } else {
      cardFields.push({ name: f, value: String(field.value), state: "check", via: field.via, reason: "check this" });
    }
  }
  const pricingPick = jev.ok
    ? judgedLinks.find((l) => jev.answers[`d9_${l.href}`]?.choice === "pricing")
    : undefined;
  cardFields.push(
    pricingPick
      ? { name: "pricing_page", value: pricingPick.href, state: "check", via: "d9", reason: "check this" }
      : { name: "pricing_page", value: null, state: "empty", via: "", reason: "we'll fill this after the first crawl" },
  );
  if (jev.ok) {
    verdictRows.push({
      question_id: "public_subject",
      input_hash: packHash,
      p: publicP ?? null,
      choice: null,
      reason: jev.answers.public_subject?.reason ?? null,
    });
    for (const link of judgedLinks) {
      const ans = jev.answers[`d9_${link.href}`];
      verdictRows.push({
        question_id: "d9_page_role",
        input_hash: link.roleHash,
        p: ans?.choice ? (ans.probabilities?.[ans.choice] ?? null) : null,
        choice: ans?.choice ?? null,
        reason: ans?.reason ?? "no answer returned",
      });
    }
  }

  const now = new Date().toISOString();
  const domain = subject.registrable ?? subject.handle ?? args.input;
  const runId = args.onboardingRunId ?? id();
  const jevStatus = !deps.jev ? "unconfigured" : jev.ok ? "ok" : "unreachable";
  const identityJson = JSON.stringify({
    version: 1,
    run_id: runId,
    subject,
    fields: Object.fromEntries(
      cardFields.map((f) => [f.name, { value: f.value, state: f.state, via: f.via, reason: f.reason ?? null }]),
    ),
    pack_hash: packHash,
    verdict_count: verdictRows.length,
    built_at: now,
    jev_status: jevStatus,
    public_subject: publicSubject,
    transport: homepage.ok ? homepage.transport : null,
    browser_ms_used: homepage.ok ? (homepage.browserMsUsed ?? null) : null,
    probe_failures: probeFailures,
  });

  const entityId = (await selfEntityIdForDomain(deps.db, args.workspaceId, domain)) ?? id();

  const stmts: D1PreparedStatement[] = [
    upsertSelfEntityStmt(deps.db, {
      id: entityId,
      workspaceId: args.workspaceId,
      domain,
      name: cardFields.find((f) => f.name === "name")?.value ?? null,
      identityJson,
      now,
    }),
    insertOnboardingRunStmt(deps.db, {
      id: runId,
      workspaceId: args.workspaceId,
      userId: args.userId,
      inputRaw: args.input,
      now,
    }),
  ];
  if (subject.url) {
    stmts.push(
      insertHomePageStmt(deps.db, {
        id: id(),
        entityId,
        url: subject.url,
        title: extracted?.title ?? null,
        now,
      }),
    );
  }
  if (jev.ok) {
    for (const link of judgedLinks) {
      const choice = jev.answers[`d9_${link.href}`]?.choice;
      stmts.push(
        insertRolePageStmt(deps.db, {
          id: id(),
          entityId,
          url: link.href,
          role: choice && choice in PAGE_ROLES ? choice : "other",
          roleHash: link.roleHash,
          now,
        }),
      );
    }
  }
  for (const v of verdictRows) {
    stmts.push(
      insertVerdictStmt(deps.db, {
        id: id(),
        workspaceId: args.workspaceId,
        questionId: v.question_id,
        inputHash: v.input_hash,
        entityId,
        p: v.p,
        choice: v.choice,
        reason: v.reason,
        now,
      }),
    );
  }
  await deps.db.batch(stmts);

  return {
    ok: true,
    subject,
    entityId,
    onboardingRunId: runId,
    fields: cardFields,
    packHash,
    verdictCount: verdictRows.length,
    transport: homepage.ok ? homepage.transport : null,
    browserMsUsed: homepage.ok ? (homepage.browserMsUsed ?? null) : null,
    jevStatus,
    publicSubject,
    probeFailures,
  };
}

const StoredField = z.object({
  value: z.string().nullable(),
  state: z.enum(["filled", "check", "empty"]),
  via: z.string(),
  reason: z.string().nullable().optional(),
});

const StoredIdentityJson = z.object({
  version: z.literal(1),
  run_id: z.string(),
  subject: NormalisedSubject,
  fields: z.record(z.string(), StoredField),
  pack_hash: z.string(),
  verdict_count: z.number(),
  built_at: z.string(),
  jev_status: z.enum(["ok", "unconfigured", "unreachable"]),
  public_subject: z.enum(["cleared", "ask", "unverified"]),
  transport: z.enum(["fetch", "browser"]).nullable(),
  browser_ms_used: z.number().nullable(),
  probe_failures: z.array(z.object({ leg: z.string(), reason: z.string() })),
});

const CARD_FIELD_ORDER = new Map([...D7_FIELDS, "pricing_page"].map((name, i) => [name, i]));

export function cardFromIdentityJson(entityId: string, identityJson: string): CardResult {
  const stored = StoredIdentityJson.parse(JSON.parse(identityJson));
  const fields: CardField[] = Object.entries(stored.fields)
    .sort(([a], [b]) => (CARD_FIELD_ORDER.get(a) ?? 99) - (CARD_FIELD_ORDER.get(b) ?? 99))
    .map(([name, f]) => ({
      name,
      value: f.value,
      state: f.state,
      via: f.via,
      ...(f.reason ? { reason: f.reason } : {}),
    }));
  return {
    ok: true,
    subject: stored.subject,
    entityId,
    onboardingRunId: stored.run_id,
    fields,
    packHash: stored.pack_hash,
    verdictCount: stored.verdict_count,
    transport: stored.transport,
    browserMsUsed: stored.browser_ms_used,
    jevStatus: stored.jev_status,
    publicSubject: stored.public_subject,
    probeFailures: stored.probe_failures,
  };
}

export async function buildCardFromRequest(args: {
  workspaceId: string;
  userId: string;
  input: string;
  onboardingRunId?: string;
}): Promise<CardResult> {
  return buildIdentityCard(
    { db: env.DB, cache: env.IDENTITY_CACHE, jev: jevConfig(env) },
    args,
  );
}
