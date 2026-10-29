import { describe, expect, it, vi } from "vitest";

import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import { IS_COMPETITOR, IS_CREATOR_RIVAL, SAME_CATEGORY, competitorState } from "../../app/lib/discovery/run.server";
import type { Evidence } from "../../app/lib/discovery/types";
import {
  DESCRIPTION_QUESTION,
  NAME_QUESTION,
  SOCIALS_QUESTION,
  fieldConfidenceState,
} from "../../app/lib/identity/field-confidence.server";
import { normaliseSubject } from "../../app/lib/identity/normalise";
import type { Subject } from "../../app/lib/identity/normalise";
import { PAGE_ROLE, pageRoleState } from "../../app/lib/identity/page-role.server";
import { probeKey } from "../../app/lib/identity/probe-cache.server";
import type { ProbeName } from "../../app/lib/identity/probe-cache.server";
import { PUBLIC_SUBJECT, publicSubjectState } from "../../app/lib/jev/public-subject.server";
import { sha256Hex } from "../../app/lib/sha256";
import { aiBinding } from "./harness";

vi.mock("../../app/lib/data/takedown.server", () => ({ takenDownAmong: () => Promise.resolve(new Set()) }));
vi.mock("../../app/lib/jev/client.server", () => ({
  askNoul: () => Promise.resolve(null),
  askNouls: () => Promise.resolve([]),
  askChoice: () => Promise.resolve(null),
  JevUnavailableError: class JevUnavailableError extends Error {},
  JevRateLimitedError: class JevRateLimitedError extends Error {},
}));
vi.mock("../../app/lib/discovery/resolve-domain.server", () => ({
  resolveDomain: () => Promise.resolve({ domain: null }),
}));
vi.mock("../../app/lib/discovery/generators/ai.server", () => ({ aiGenerator: () => Promise.resolve([]) }));
vi.mock("../../app/lib/discovery/generators/hn.server", () => ({ hnGenerator: () => Promise.resolve([]) }));

const CUTOFF = "2026-10-03T17:34:18Z";
const DATABASE_ID = "746c6e3d-782e-443a-82d6-28ca93a16294";
const KV_NAMESPACE_ID = "583a3ce85fac4da0b811902674481663";
const CONCURRENCY = 4;
const CALLS_PER_MINUTE = 50;
const AGREE_WITHIN = 0.15;
const CHARS_PER_TOKEN = 4;
const CLEF: Model = { binding: "@cf/cloudflare/clef", selector: "clef" };
const FLASH_SHAPES: Model[] = [
  { binding: "@cf/cloudflare/clef-flash", selector: "clef-flash" },
  { binding: "@cf/cloudflare/clef", selector: "clef-flash" },
];
const PROBE_QUESTION = {
  type: "noul",
  instructions: "Is the item the number five?",
  criteria: { true: "The item is the number five.", false: "The item is not the number five." },
};
const EDITED_FIELDS = [[], ["name"], ["description"], ["name", "description"]] as const;
const NEURONS_PER_CALL = 17;
const DAILY_NEURON_CEILING = 9000;
const BUDGET_MARGIN = 1.2;

const SAME_CATEGORY_BEFORE_2026_10_04: NoulQuestion = {
  id: "same_product_category",
  instructions:
    "Does `item` mainly sell the same kind of product or service that `self` mainly sells? Judge the product category: what a customer actually buys from each. Do not count shared values, audience, price, style or business model. A shoe brand and a clothing brand are different categories even when both are sustainable and sold to the same people; a meal kit and a restaurant are different categories. `self.description` says what `self` sells and `item.evidence` says what `item` sells.",
  whenTrue:
    "What `item` mainly sells is the same kind of product or service as what `self` mainly sells, so a buyer shopping for one would consider the other.",
  whenFalse:
    "What `item` mainly sells is a different kind of product or service, even if it shares `self`'s values, audience, customers, style or business model.",
};

interface Model {
  binding: string;
  selector: string;
}

interface NoulQuestion {
  id: string;
  instructions: string;
  whenTrue: string;
  whenFalse: string;
}

interface ChoiceQuestion {
  id: string;
  instructions: string;
  options: Readonly<Record<string, string>>;
}

type Question = NoulQuestion | ChoiceQuestion;

const QUESTIONS: Record<string, Question[]> = {
  [PUBLIC_SUBJECT.id]: [PUBLIC_SUBJECT],
  [IS_COMPETITOR.id]: [IS_COMPETITOR],
  [IS_CREATOR_RIVAL.id]: [IS_CREATOR_RIVAL],
  [SAME_CATEGORY.id]: [SAME_CATEGORY, SAME_CATEGORY_BEFORE_2026_10_04],
  [PAGE_ROLE.id]: [PAGE_ROLE],
  [NAME_QUESTION.id]: [NAME_QUESTION],
  [DESCRIPTION_QUESTION.id]: [DESCRIPTION_QUESTION],
  [SOCIALS_QUESTION.id]: [SOCIALS_QUESTION],
};

const FIELD_QUESTIONS = [NAME_QUESTION.id, DESCRIPTION_QUESTION.id, SOCIALS_QUESTION.id];

interface Verdict {
  workspace: string;
  question: string;
  hash: string;
  entityId: string | null;
  p: number | null;
  choice: string | null;
}

interface Review {
  verdict: Verdict;
  question: Question;
  state: unknown;
  earlierText: boolean;
}

interface EntityRow {
  id: string;
  workspace: string;
  role: string;
  domain: string;
  name: string | null;
  description: string | null;
  kind: string | null;
  state: string;
}

interface Suggestion {
  domain: string;
  name: string | null;
  evidence: Evidence[];
  status: string;
}

interface PageRow {
  url: string;
  title: string;
}

interface CardSocial {
  platform: string;
  url: string;
}

interface Card {
  name: string | null;
  description: string | null;
  socials: CardSocial[];
}

interface Index {
  raws: Map<string, string[]>;
  contexts: Map<string, DiscoveryContext>;
  suggestions: Map<string, Suggestion[]>;
  domains: Map<string, string>;
  pages: Map<string, PageRow[]>;
  cards: Map<string, Promise<Card | null>>;
  kvFailure: string | null;
}

interface Skips {
  reasons: Map<string, Map<string, number>>;
}

interface Call {
  review: Review;
  ok: boolean;
  error: string | null;
  p: number | null;
  choice: string | null;
  ms: number;
  tokens: number;
}

interface Stats {
  calls: number;
  ok: number;
  errors: number;
  agree: number;
  deltaRows: number;
  meanDelta: number;
  p50: number;
  p95: number;
  largest: number;
}

const ROW_SQL = [
  "SELECT id, workspace_id, question_id, input_hash, entity_id, p, choice, decided_at",
  "FROM jev_verdict WHERE decided_at < ? ORDER BY decided_at",
].join(" ");

async function verdictRows(): Promise<Verdict[]> {
  const rows = await d1Rows(ROW_SQL, [CUTOFF]);
  return rows.map((row) => ({
    workspace: str(row, "workspace_id"),
    question: str(row, "question_id"),
    hash: str(row, "input_hash"),
    entityId: maybeStr(row, "entity_id"),
    p: maybeNum(row, "p"),
    choice: maybeStr(row, "choice"),
  }));
}

async function reconstruct(verdicts: readonly Verdict[], index: Index): Promise<{ reviews: Review[]; skips: Skips }> {
  const reviews: Review[] = [];
  const skips: Skips = { reasons: new Map() };
  for (const verdict of verdicts) {
    const versions = QUESTIONS[verdict.question];
    if (versions === undefined) {
      countSkip(skips, verdict.question, "the question id is not in the current set");
      continue;
    }
    const states = await statesFor(verdict, index);
    const matched = await matchedVersion(verdict, versions, states);
    if (matched !== null) {
      reviews.push({ verdict, question: matched.question, state: matched.state, earlierText: matched.earlierText });
      continue;
    }
    countSkip(
      skips,
      verdict.question,
      states.length === 0
        ? emptyReason(verdict, index)
        : "the rebuilt state hashes differently from the recorded input_hash",
    );
  }
  return { reviews, skips };
}

async function matchedVersion(
  verdict: Verdict,
  versions: readonly Question[],
  states: readonly unknown[],
): Promise<{ question: Question; state: unknown; earlierText: boolean } | null> {
  for (const [position, question] of versions.entries()) {
    for (const state of states) {
      if ((await hashOf(verdict.workspace, question, state)) === verdict.hash) {
        return { question, state, earlierText: position > 0 };
      }
    }
  }
  return null;
}

function hashOf(workspace: string, question: Question, state: unknown): Promise<string> {
  const payload = isNoul(question)
    ? { workspace, question: question.id, instructions: question.instructions, state }
    : { workspace, question: question.id, instructions: question.instructions, options: question.options, state };
  return sha256Hex(JSON.stringify(payload));
}

function isNoul(question: Question): question is NoulQuestion {
  return !("options" in question);
}

async function statesFor(verdict: Verdict, index: Index): Promise<unknown[]> {
  if (verdict.question === PUBLIC_SUBJECT.id) return publicStates(verdict, index);
  if (verdict.question === PAGE_ROLE.id) return pageStates(verdict, index);
  if (FIELD_QUESTIONS.includes(verdict.question)) return fieldStates(verdict, index);
  return competitorStates(verdict, index);
}

function publicStates(verdict: Verdict, index: Index): unknown[] {
  return (index.raws.get(verdict.workspace) ?? []).flatMap((raw) => {
    const normalised = normaliseSubject(raw);
    return normalised.ok ? [publicSubjectState(normalised.subject, raw)] : [];
  });
}

function pageStates(verdict: Verdict, index: Index): unknown[] {
  if (verdict.entityId === null) return [];
  const domain = index.domains.get(verdict.entityId);
  const pages = index.pages.get(verdict.entityId) ?? [];
  return domain === undefined ? [] : pages.map((page) => pageRoleState(domain, page));
}

function competitorStates(verdict: Verdict, index: Index): unknown[] {
  const context = index.contexts.get(verdict.workspace);
  if (context === undefined) return [];
  return (index.suggestions.get(verdict.workspace) ?? []).flatMap((suggestion) =>
    suggestion.name === null
      ? []
      : [
          competitorState(context, {
            name: suggestion.name,
            domain: suggestion.domain,
            evidence: suggestion.evidence,
            line: "",
          }),
        ],
  );
}

async function fieldStates(verdict: Verdict, index: Index): Promise<unknown[]> {
  const subjects = (index.raws.get(verdict.workspace) ?? []).flatMap((raw) => {
    const normalised = normaliseSubject(raw);
    return normalised.ok && probeOf(normalised.subject) !== null ? [normalised.subject] : [];
  });
  const states = await Promise.all(subjects.map((subject) => cardStates(subject, index)));
  return states.flat();
}

function probeOf(subject: Subject): ProbeName | null {
  if (subject.kind === "domain") return "homepage";
  if (subject.url === null) return null;
  if (subject.platform === "youtube") return "youtube-profile";
  if (subject.platform === "instagram") return "instagram-profile";
  return null;
}

async function cardStates(subject: Subject, index: Index): Promise<unknown[]> {
  const card = await cardOf(subject, index);
  if (card === null) return [];
  const fields = cardValues(subject, card);
  return EDITED_FIELDS.map((edited) => fieldConfidenceState(subject, fields, edited));
}

function cardValues(
  subject: Subject,
  card: Card,
): { name: string | null; description: string | null; socials: CardSocial[] } {
  return {
    name: card.name ?? (subject.kind === "domain" ? null : `@${subject.registrable}`),
    description: card.description,
    socials:
      subject.url !== null && subject.kind !== "domain"
        ? [
            { platform: subject.platform ?? "site", url: subject.url },
            ...card.socials.filter((social) => social.platform !== subject.platform),
          ]
        : card.socials,
  };
}

async function cardOf(subject: Subject, index: Index): Promise<Card | null> {
  const probe = probeOf(subject);
  if (probe === null) return null;
  const key = probeKey(subject, probe);
  const cached = index.cards.get(key);
  if (cached !== undefined) return cached;
  const load = readCard(key).catch((error: unknown) => {
    index.kvFailure ??= String(error);
    return null;
  });
  index.cards.set(key, load);
  return load;
}

async function readCard(key: string): Promise<Card | null> {
  const response = await kvResponse(key);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`kv read failed with ${response.status}`);
  return asCard(await response.json());
}

async function buildIndex(): Promise<Index> {
  const [rawRows, entityRows, suggestionRows, pageRows] = await Promise.all([
    d1Rows("SELECT workspace_id, input_raw FROM onboarding_run"),
    d1Rows(
      "SELECT id, workspace_id, role, domain, name, state, json_extract(identity_json, '$.description') AS description, json_extract(identity_json, '$.kind') AS kind FROM entity",
    ),
    d1Rows("SELECT workspace_id, candidate_domain, candidate_name, evidence_json, status FROM suggestion"),
    d1Rows("SELECT entity_id, url, title FROM page WHERE role_decided_for_hash IS NOT NULL AND title IS NOT NULL"),
  ]);
  const entities = entityRows.map(asEntity);
  const raws = new Map<string, string[]>();
  for (const row of rawRows) pushTo(raws, str(row, "workspace_id"), str(row, "input_raw"));
  const suggestions = new Map<string, Suggestion[]>();
  for (const row of suggestionRows) {
    pushTo(suggestions, str(row, "workspace_id"), {
      domain: str(row, "candidate_domain"),
      name: maybeStr(row, "candidate_name"),
      evidence: parseEvidence(maybeStr(row, "evidence_json")),
      status: str(row, "status"),
    });
  }
  const pages = new Map<string, PageRow[]>();
  for (const row of pageRows) {
    const title = maybeStr(row, "title");
    if (title !== null) pushTo(pages, str(row, "entity_id"), { url: str(row, "url"), title });
  }
  return {
    raws,
    contexts: contextsOf(entities, suggestions),
    suggestions,
    domains: new Map(entities.map((entity) => [entity.id, entity.domain])),
    pages,
    cards: new Map(),
    kvFailure: null,
  };
}

function asEntity(row: Record<string, unknown>): EntityRow {
  return {
    id: str(row, "id"),
    workspace: str(row, "workspace_id"),
    role: str(row, "role"),
    domain: str(row, "domain"),
    name: maybeStr(row, "name"),
    description: maybeStr(row, "description"),
    kind: maybeStr(row, "kind"),
    state: str(row, "state"),
  };
}

function contextsOf(
  entities: readonly EntityRow[],
  suggestions: Map<string, Suggestion[]>,
): Map<string, DiscoveryContext> {
  const byWorkspace = new Map<string, EntityRow[]>();
  for (const entity of entities) pushTo(byWorkspace, entity.workspace, entity);
  const contexts = new Map<string, DiscoveryContext>();
  for (const [workspace, rows] of byWorkspace) {
    const self = rows.find((row) => row.role === "self");
    if (self === undefined) continue;
    contexts.set(workspace, {
      self: {
        workspaceId: workspace,
        name: displayName(self),
        domain: self.domain,
        description: self.description,
        kind: self.kind === "channel" || self.kind === "handle" ? "creator" : "domain",
      },
      competitors: rows
        .filter((row) => row.role === "competitor" && row.state === "on")
        .map((row) => ({ name: displayName(row), domain: row.domain })),
      knownDomains: rows.filter((row) => row.role !== "suggestion").map((row) => row.domain),
      dismissedDomains: [
        ...rows
          .filter((row) => row.state === "dismissed" || (row.role === "competitor" && row.state === "off"))
          .map((row) => row.domain),
        ...(suggestions.get(workspace) ?? []).filter((item) => item.status === "dismissed").map((item) => item.domain),
      ],
    });
  }
  return contexts;
}

function displayName(row: EntityRow): string {
  return row.name === null || row.name === "" ? row.domain : row.name;
}

function parseEvidence(json: string | null): Evidence[] {
  const body = obj(json === null ? null : safeJson(json));
  const list = body?.evidence;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const evidence = obj(item);
    const sourceUrl = evidence?.sourceUrl;
    const excerpt = evidence?.excerpt;
    return typeof sourceUrl === "string" && typeof excerpt === "string"
      ? [{ sourceUrl, excerpt, generator: "news" as const }]
      : [];
  });
}

function emptyReason(verdict: Verdict, index: Index): string {
  if (verdict.question === PUBLIC_SUBJECT.id) return "no onboarding input is left to rebuild the public subject";
  if (verdict.question === PAGE_ROLE.id) return "no judged page row is left on the entity it judged";
  if (FIELD_QUESTIONS.includes(verdict.question)) {
    if (index.kvFailure !== null) return `the identity cache read failed: ${index.kvFailure}`;
    const rebuildable = (index.raws.get(verdict.workspace) ?? []).some((raw) => {
      const normalised = normaliseSubject(raw);
      return normalised.ok && probeOf(normalised.subject) !== null;
    });
    return rebuildable
      ? "the 24h identity card cache no longer holds the card it judged"
      : "the workspace input has no card kind this replay rebuilds";
  }
  return "no suggestion row is left to rebuild the judged candidate";
}

function countSkip(skips: Skips, question: string, reason: string): void {
  const byReason = skips.reasons.get(question) ?? new Map<string, number>();
  byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  skips.reasons.set(question, byReason);
}

function bodyFor(model: Model, review: Review): Record<string, unknown> {
  return {
    model: model.selector,
    state: review.state,
    questions: { [review.question.id]: wire(review.question) },
  };
}

function wire(question: Question): Record<string, unknown> {
  return isNoul(question)
    ? {
        type: "noul",
        instructions: question.instructions,
        criteria: { true: question.whenTrue, false: question.whenFalse },
      }
    : { type: "choice", instructions: question.instructions, criteria: question.options };
}

async function runOne(model: Model, review: Review): Promise<Call> {
  const body = bodyFor(model, review);
  const tokens = Math.ceil(JSON.stringify(body).length / CHARS_PER_TOKEN);
  const ai = await aiBinding();
  await pace();
  const started = performance.now();
  try {
    const raw = await ai.run(model.binding as never, body as never);
    const answer = answerOf(raw, review.question.id);
    return {
      review,
      ok: true,
      error: null,
      p: answer.p,
      choice: answer.choice,
      ms: Math.round(performance.now() - started),
      tokens,
    };
  } catch (error) {
    return { review, ok: false, error: String(error).slice(0, 200), p: null, choice: null, ms: 0, tokens };
  }
}

function answerOf(raw: unknown, questionId: string): { p: number | null; choice: string | null } {
  const answer = obj(answersOf(raw)[questionId]);
  if (answer === null) throw new Error(`no answer for ${questionId}`);
  const noul = answer.noul;
  const choice = answer.choice;
  if (typeof choice === "string") return { p: null, choice };
  if (typeof noul === "number") return { p: noul, choice: null };
  throw new Error(`the answer for ${questionId} carried neither noul nor choice`);
}

function answersOf(raw: unknown): Record<string, unknown> {
  const outer = obj(raw);
  const response = outer?.response;
  const inner = typeof response === "string" ? safeJson(response) : (response ?? outer?.result ?? raw);
  return obj(obj(inner)?.answers) ?? {};
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`expected a string ${key}, got ${typeof value}`);
  return value;
}

function maybeStr(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function maybeNum(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

let nextSlot = 0;

async function pace(): Promise<void> {
  const gap = 60_000 / CALLS_PER_MINUTE;
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + gap;
  const wait = slot - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index] as T);
    }
  };
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)).then(() => results);
}

async function d1Rows(
  sql: string,
  params: readonly (string | number | null)[] = [],
): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId()}/d1/database/${DATABASE_ID}/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  const payload = (await response.json()) as {
    success?: boolean;
    errors?: { message?: string }[];
    result?: { results?: Record<string, unknown>[] }[];
  };
  if (!response.ok || payload.success !== true) {
    throw new Error(`the d1 query failed with ${response.status}: ${payload.errors?.[0]?.message ?? ""}`);
  }
  return payload.result?.[0]?.results ?? [];
}

function kvResponse(key: string): Promise<Response> {
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId()}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
    { headers: { authorization: `Bearer ${apiToken()}` }, signal: AbortSignal.timeout(30_000) },
  );
}

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const DAILY_QUERY = `query($account: String!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    aiInferenceAdaptiveGroups(limit: 1, filter: { datetime_geq: $since, datetime_leq: $until }) {
      sum { totalNeurons }
    }
  } }
}`;

interface DailyReply {
  data?: { viewer?: { accounts?: { aiInferenceAdaptiveGroups?: { sum?: { totalNeurons?: unknown } }[] }[] } };
  errors?: unknown;
}

async function budgetGuard(calls: number): Promise<void> {
  const planned = Math.round(calls * NEURONS_PER_CALL * BUDGET_MARGIN);
  const today = await neuronsToday();
  console.log(
    `ai neurons already used today (UTC): ${String(Math.round(today))}; this replay plans about ${String(planned)} against a daily ceiling of ${String(DAILY_NEURON_CEILING)}`,
  );
  if (today + planned > DAILY_NEURON_CEILING) {
    throw new Error(
      `the replay plans about ${String(planned)} neurons and ${String(Math.round(today))} are already spent today, over the ${String(DAILY_NEURON_CEILING)} daily ceiling (0509#7249)`,
    );
  }
}

async function neuronsToday(): Promise<number> {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiToken()}` },
    body: JSON.stringify({
      query: DAILY_QUERY,
      variables: { account: accountId(), since: since.toISOString(), until: now.toISOString() },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`the neuron query answered ${String(response.status)}`);
  const reply = (await response.json()) as DailyReply;
  if (reply.errors !== undefined && reply.errors !== null) throw new Error("the neuron query returned errors");
  const groups = reply.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
  if (groups === undefined) throw new Error("the neuron query returned no aiInferenceAdaptiveGroups");
  const total = groups[0]?.sum?.totalNeurons ?? 0;
  if (typeof total !== "number" || !Number.isFinite(total)) throw new Error("the neuron total was not a number");
  return total;
}

function accountId(): string {
  const value = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  if (value === "") throw new Error("the replay needs CLOUDFLARE_ACCOUNT_ID");
  return value;
}

function apiToken(): string {
  const value = process.env.CLOUDFLARE_API_TOKEN ?? "";
  if (value === "") throw new Error("the replay needs CLOUDFLARE_API_TOKEN");
  return value;
}

function asCard(raw: unknown): Card | null {
  const card = obj(raw);
  const socials = card?.socials;
  if (card === null || !Array.isArray(socials)) return null;
  const parsed: CardSocial[] = [];
  for (const item of socials) {
    const social = obj(item);
    const platform = social?.platform;
    const url = social?.url;
    if (typeof platform !== "string" || typeof url !== "string") return null;
    parsed.push({ platform, url });
  }
  return { name: maybeStr(card, "name"), description: maybeStr(card, "description"), socials: parsed };
}

function statsOf(calls: readonly Call[]): Stats {
  const ok = calls.filter((call) => call.ok);
  const deltas = ok.flatMap((call) => {
    const expected = call.review.verdict.p;
    if (call.p === null || expected === null) return [];
    return [Math.abs(call.p - expected)];
  });
  const latencies = ok.map((call) => call.ms).sort((left, right) => left - right);
  return {
    calls: calls.length,
    ok: ok.length,
    errors: calls.length - ok.length,
    agree: calls.filter(agrees).length,
    deltaRows: deltas.length,
    meanDelta: deltas.length === 0 ? 0 : deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    largest: calls.reduce((largest, call) => Math.max(largest, call.tokens), 0),
  };
}

function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0);
}

function agrees(call: Call): boolean {
  if (!call.ok) return false;
  const expected = call.review.verdict;
  if (expected.choice !== null) return call.choice === expected.choice;
  if (expected.p === null || call.p === null) return false;
  return Math.abs(call.p - expected.p) <= AGREE_WITHIN;
}

function ratio(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((100 * part) / whole).toFixed(1)}%`;
}

function meanDelta(stats: Stats): string {
  return stats.deltaRows === 0 ? "n/a" : stats.meanDelta.toFixed(3);
}

function armLine(model: Model, stats: Stats): string {
  const label = `${model.binding} (${model.selector})`;
  return `${label}: calls ${stats.calls}, ok ${stats.ok}, errors ${stats.errors} (${ratio(stats.errors, stats.calls)}), agreement ${ratio(stats.agree, stats.ok)}, mean |dP| ${meanDelta(stats)}, p50 ${stats.p50} ms, p95 ${stats.p95} ms, largest input ${stats.largest} tokens`;
}

function questionLine(question: string, stats: Stats): string {
  return `  ${question}: calls ${stats.calls}, ok ${stats.ok}, errors ${stats.errors}, agreement ${ratio(stats.agree, stats.ok)}, mean |dP| ${meanDelta(stats)}, p50 ${stats.p50} ms, p95 ${stats.p95} ms`;
}

async function probe(model: Model): Promise<string | null> {
  try {
    const ai = await aiBinding();
    await pace();
    const raw = await ai.run(
      model.binding as never,
      {
        model: model.selector,
        state: { item: 5 },
        questions: { jev_probe: PROBE_QUESTION },
      } as never,
    );
    answerOf(raw, "jev_probe");
    return null;
  } catch (error) {
    return String(error).slice(0, 200);
  }
}

async function pickFlash(): Promise<Model | null> {
  for (const shape of FLASH_SHAPES) {
    const failure = await probe(shape);
    if (failure === null) return shape;
    console.log(`preflight ${shape.binding} (${shape.selector}) failed: ${failure}`);
  }
  return null;
}

describe("jev replay", () => {
  it("replays the Jev-era verdicts through the clef models", async () => {
    const verdicts = await verdictRows();
    const index = await buildIndex();
    const { reviews, skips } = await reconstruct(verdicts, index);
    console.log(`jev-era verdicts recorded before ${CUTOFF}: ${verdicts.length}, rebuilt states ${reviews.length}`);
    for (const [question, found] of countBy(verdicts.map((verdict) => verdict.question))) {
      const replayed = reviews.filter((review) => review.question.id === question).length;
      console.log(`${question}: found ${found}, replayed ${replayed}, skipped ${found - replayed}`);
      for (const [reason, count] of skips.reasons.get(question) ?? []) {
        console.log(`  skipped ${count}: ${reason}`);
      }
    }
    const clefFailure = await probe(CLEF);
    if (clefFailure !== null) console.log(`preflight ${CLEF.binding} failed: ${clefFailure}`);
    const flash = await pickFlash();
    if (flash === null) console.log("no clef-flash call shape answered, so the flash arm is missing");
    const models = flash === null ? [CLEF] : [CLEF, flash];
    const earlier = reviews.filter((review) => review.earlierText).length;
    console.log(
      `replayed rows judged under the 2026-10-03 same_product_category text: ${earlier}; every question goes on its own, as the evals do`,
    );
    await budgetGuard(models.length * (reviews.length + 3));
    console.log(
      `replay started at ${new Date().toISOString()}, no ai gateway, at most ${CALLS_PER_MINUTE} calls a minute account-wide`,
    );
    const arms = await Promise.all(
      models.map((model) => mapLimit(reviews, CONCURRENCY, (review) => runOne(model, review))),
    );
    for (const [position, model] of models.entries()) {
      const calls = arms[position] ?? [];
      console.log(armLine(model, statsOf(calls)));
      for (const [question] of countBy(calls.map((call) => call.review.question.id))) {
        const group = calls.filter((call) => call.review.question.id === question);
        console.log(questionLine(question, statsOf(group)));
      }
      for (const [error] of countBy(calls.flatMap((call) => (call.ok ? [] : [call.error ?? "unknown error"])))) {
        console.log(`  error: ${error}`);
      }
    }
    expect(reviews.length).toBeGreaterThan(0);
  });
});

function countBy(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}
