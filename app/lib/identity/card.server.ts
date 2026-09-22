import { env } from "cloudflare:workers";
import { z } from "zod";

import { insertUserDecisions } from "../data/user-decision.server";
import { readUrl, type ReadUrlResult } from "../fetch/transport.server";
import { jevAsk, type JevQuestion } from "../jev/client";
import { buildIdentityPack, inputHash } from "../jev/context-pack";
import type { CardField, CardResult } from "./card-types";
import { extract, type Extracted } from "./extract";
import { logoCandidates, resolveLogo } from "./logo-cascade";
import { normaliseInput } from "./normalise";
import { probeThrough } from "./probe-cache";

interface CardDeps {
  db: D1Database;
  cache?: KVNamespace;
  jev?: { url: string; apiKey?: string };
}

const D7_FIELDS = ["name", "logo", "description", "category", "country", "socials", "pricing_page"] as const;
const PAGE_ROLES = { home: "", pricing: "", product: "", blog: "", careers: "", legal: "", other: "" } as const;
const NAV_JUDGED = 10;
const REFUSAL_LINE = "we track brands and creators, not people";

function id(): string {
  return crypto.randomUUID();
}

async function probe<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "failed" };
  }
}

async function wikidata(name: string): Promise<{ qid: string; claims: Record<string, unknown> } | null> {
  const s = await fetch(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=1`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!s.ok) return null;
  const hits = z.object({ search: z.array(z.object({ id: z.string() })).optional() }).parse(await s.json());
  const qid = hits.search?.[0]?.id;
  if (!qid) return null;
  const c = await fetch(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!c.ok) return { qid, claims: {} };
  const body = z
    .object({ entities: z.record(z.string(), z.object({ claims: z.record(z.string(), z.unknown()).optional() })).optional() })
    .parse(await c.json());
  return { qid, claims: body.entities?.[qid]?.claims ?? {} };
}

async function recordRefusal(
  deps: CardDeps,
  args: { workspaceId: string; userId: string; input: string },
  verdict: string,
  note: string,
  verdictRow?: { p: number | null; reason: string | null; inputHash: string },
): Promise<void> {
  if (verdictRow) {
    await deps.db
      .prepare(
        `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, entity_id, p, choice, reason, decided_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT (question_id, input_hash) DO NOTHING`,
      )
      .bind(
        id(),
        args.workspaceId,
        "public_subject",
        verdictRow.inputHash,
        null,
        verdictRow.p,
        null,
        verdictRow.reason,
        new Date().toISOString(),
      )
      .run();
  }
  await insertUserDecisions(deps.db, [
    { workspaceId: args.workspaceId, userId: args.userId, verdict, note },
  ]);
}

export async function buildIdentityCard(
  deps: CardDeps,
  args: { workspaceId: string; userId: string; input: string; onboardingRunId?: string },
): Promise<CardResult> {
  const norm = normaliseInput(args.input);
  if (!norm.ok) return { ok: false, reason: norm.reason };
  const subject = norm.subject;

  const refusalKey = subject.registrable ?? subject.handle ?? args.input;
  const priorRefusal = await deps.db
    .prepare(
      `SELECT id FROM user_decision WHERE workspace_id = ? AND verdict LIKE 'refused:%' AND note = ? LIMIT 1`,
    )
    .bind(args.workspaceId, refusalKey)
    .first<{ id: string }>()
    .catch(() => null);
  if (priorRefusal) return { ok: false, reason: REFUSAL_LINE };

  const subjects = [subject.registrable, subject.handle && `${subject.platform ?? "*"}:${subject.handle}`].filter(
    (s): s is string => Boolean(s),
  );
  if (subjects.length) {
    const rows = await deps.db
      .prepare(`SELECT subject FROM takedown WHERE subject IN (${subjects.map(() => "?").join(",")})`)
      .bind(...subjects)
      .all<{ subject: string }>()
      .catch(() => ({ results: [] as { subject: string }[] }));
    if (rows.results.length) {
      await recordRefusal(deps, args, "refused:takedown", refusalKey);
      return { ok: false, reason: REFUSAL_LINE };
    }
  }

  const cacheKey = subject.registrable ?? subject.handle ?? subject.input;
  const cache = deps.cache;

  const pageUrl = subject.url;
  const homepage: ReadUrlResult = pageUrl
    ? await probeThrough(
        cache,
        cacheKey,
        "homepage",
        () => readUrl(pageUrl),
        (v) => v.ok,
      )
    : { ok: false, reason: "invalid-url", detail: "no homepage URL for this input" };

  const html = homepage.ok ? homepage.html : null;
  const extractedRes = html && pageUrl ? await probe(() => extract(html, pageUrl)) : null;
  const extracted: Extracted | null = extractedRes?.ok ? extractedRes.value : null;

  const manifestHref = extracted?.manifestHref ?? null;
  const fetchManifestIcons = async (): Promise<string[]> => {
    if (!manifestHref) return [];
    const res = await fetch(manifestHref, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const body = z
      .object({ icons: z.array(z.object({ src: z.string(), sizes: z.string().optional() })).optional() })
      .parse(await res.json());
    return (body.icons ?? [])
      .filter((i) => !i.sizes || /512|192/.test(i.sizes))
      .map((i) => new URL(i.src, manifestHref).toString());
  };

  const candidateName = extracted?.name ?? subject.handle ?? subject.registrable ?? null;
  const wdName = candidateName ?? subject.registrable;
  const wdP = wdName
    ? probe(() => probeThrough(cache, cacheKey, "wikidata", () => wikidata(wdName)))
    : Promise.resolve(null);

  const [manifestIcons, wd] = await Promise.all([probe(fetchManifestIcons), wdP]);

  const logoP = extracted && pageUrl
    ? probeThrough(cache, cacheKey, "logo", () =>
        resolveLogo(logoCandidates(pageUrl, extracted, manifestIcons.ok ? manifestIcons.value : [])),
      )
    : Promise.resolve(null);

  const logo = await logoP;

  const fields: Record<string, { value: unknown; via: string }> = {};
  const put = (name: string, value: unknown, via: string) => {
    if (value !== null && value !== undefined && value !== "") fields[name] = { value, via };
  };
  put("name", candidateName, extracted?.ldOrganization ? "ld+json" : extracted ? "meta" : "input");
  put("logo", logo?.url ?? extracted?.logoUrl, logo ? `logo-cascade:${logo.via}` : extracted ? "ld+json|og" : "");
  put("description", extracted?.description, "meta");
  const wdClaims = wd?.ok && wd.value ? wd.value.claims : null;
  const wdCountryEntry = (
    wdClaims?.P17 as { mainsnak?: { datavalue?: { value?: { id?: string; "entity-type"?: string } } }[] } | undefined
  )?.mainsnak?.[0]?.datavalue?.value;
  const wdCountry = wdCountryEntry?.["entity-type"] === "item" ? wdCountryEntry.id : null;
  put("country", wdCountry, "wikidata");
  put("category", typeof extracted?.ldOrganization?.["@type"] === "string" ? "organization" : null, "ld+json");
  put("socials", extracted?.socials.length ? extracted.socials : null, "ld+json+links");
  const pricingCandidate = extracted?.navLinks.find((l) => /pricing|plans|membership|tarifs/i.test(l.href + " " + l.text));
  put("pricing_page", pricingCandidate?.href, "nav");

  const pack = buildIdentityPack({
    raw: args.input,
    kind: subject.kind,
    registrable: subject.registrable,
    platform: subject.platform ?? null,
    fields,
    reliability: { homepage: "scraped_page", wikidata: "official_api", nav: "scraped_page" },
  });
  const packHash = await inputHash(pack);

  const judgedLinks = extracted?.navLinks.slice(0, NAV_JUDGED) ?? [];
  const d9HashByUrl = new Map<string, string>();
  for (const link of judgedLinks) {
    d9HashByUrl.set(link.href, await inputHash({ url: link.href, title: link.text }));
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
  if (jev.ok) {
    verdictRows.push({
      question_id: "public_subject",
      input_hash: packHash,
      p: publicP ?? null,
      choice: null,
      reason: jev.answers.public_subject?.reason ?? null,
    });
    for (const [qid, ans] of Object.entries(jev.answers)) {
      if (!qid.startsWith("d9_")) continue;
      verdictRows.push({
        question_id: "d9_page_role",
        input_hash: d9HashByUrl.get(qid.slice(3)) ?? packHash,
        p: null,
        choice: ans.choice ?? null,
        reason: ans.reason ?? null,
      });
    }
  }

  const now = new Date().toISOString();
  const domain = subject.registrable ?? subject.handle ?? args.input;
  const runId = args.onboardingRunId ?? id();
  const identityJson = JSON.stringify({
    fields: Object.fromEntries(cardFields.map((f) => [f.name, { value: f.value, state: f.state, via: f.via }])),
    packHash,
    built_at: now,
  });

  const existingEntity = await deps.db
    .prepare(`SELECT id FROM entity WHERE workspace_id = ? AND domain = ?`)
    .bind(args.workspaceId, domain)
    .first<{ id: string }>();
  const entityId = existingEntity?.id ?? id();

  const stmts: D1PreparedStatement[] = [
    deps.db
      .prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
         VALUES (?,?,?,?,?,?, 'manual','on',?)
         ON CONFLICT (workspace_id, domain) DO UPDATE SET name=excluded.name, identity_json=excluded.identity_json`,
      )
      .bind(
        entityId,
        args.workspaceId,
        "self",
        domain,
        cardFields.find((f) => f.name === "name")?.value ?? null,
        identityJson,
        now,
      ),
    deps.db
      .prepare(
        `INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at, card_ready_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (id) DO UPDATE SET card_ready_at=excluded.card_ready_at`,
      )
      .bind(runId, args.workspaceId, args.userId, args.input, now, now),
  ];
  if (subject.url) {
    stmts.push(
      deps.db
        .prepare(
          `INSERT INTO page (id, entity_id, url, title, role, discovered_at) VALUES (?,?,?,?, 'home', ?)
           ON CONFLICT (entity_id, url) DO NOTHING`,
        )
        .bind(id(), entityId, subject.url, extracted?.title ?? null, now),
    );
  }
  for (const [qid, ans] of Object.entries(jev.ok ? jev.answers : {})) {
    if (!qid.startsWith("d9_")) continue;
    const linkUrl = qid.slice(3);
    const role = ans.choice && ans.choice in PAGE_ROLES ? ans.choice : "other";
    stmts.push(
      deps.db
        .prepare(
          `INSERT INTO page (id, entity_id, url, title, role, role_decided_for_hash, discovered_at)
           VALUES (?,?,?,?,?,?,?) ON CONFLICT (entity_id, url) DO NOTHING`,
        )
        .bind(id(), entityId, linkUrl, null, role, d9HashByUrl.get(linkUrl) ?? packHash, now),
      );
  }
  for (const v of verdictRows) {
    stmts.push(
      deps.db
        .prepare(
          `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, entity_id, p, choice, reason, decided_at)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT (question_id, input_hash) DO NOTHING`,
        )
        .bind(id(), args.workspaceId, v.question_id, v.input_hash, entityId, v.p, v.choice, v.reason, now),
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
  };
}

export async function buildCardFromRequest(args: {
  workspaceId: string;
  userId: string;
  input: string;
  onboardingRunId?: string;
}): Promise<CardResult> {
  const jevUrl = (env as { JEV_URL?: string }).JEV_URL;
  return buildIdentityCard(
    {
      db: env.DB,
      cache: env.IDENTITY_CACHE,
      jev: jevUrl ? { url: jevUrl, apiKey: (env as { JEV_API_KEY?: string }).JEV_API_KEY } : undefined,
    },
    args,
  );
}
