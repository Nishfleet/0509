import { env } from "cloudflare:workers";
import { z } from "zod";

import { readEntitlements } from "./plan.server";
import { shouldRetryD1, tryWhile } from "./retries.server";

const identitySocials = z.object({
  socials: z.array(z.object({ platform: z.string(), url: z.string() })).optional(),
});

export type CompetitorState = "on" | "off";

export type EntityOrigin = "manual" | "auto" | "seed";

export interface RefreshTarget {
  entityId: string;
  name: string;
  domain: string;
  origin: EntityOrigin;
}

export interface CompetitorEntity {
  id: string;
  name: string;
  domain: string;
  state: CompetitorState;
  stateChangedAt: string | null;
  stateReason: string | null;
}

export interface OnCompetitor {
  entityId: string;
  name: string;
  domain: string;
  reason: string | null;
}

export interface MaybeCompetitor {
  suggestionId: string;
  name: string;
  domain: string;
  reason: string | null;
}

const readCompetitorRow = z.object({
  id: z.string(),
  name: z.string().nullable(),
  domain: z.string(),
  state: z.enum(["on", "off"]),
  state_changed_at: z.string().nullable(),
  state_reason: z.string().nullable(),
});

export interface RetireQuestion {
  suggestionId: string;
  entityId: string;
  name: string;
  domain: string;
  reason: string | null;
}

const onRow = z.object({
  entity_id: z.string(),
  name: z.string().nullable(),
  domain: z.string(),
  reason: z.string().nullable(),
});

const maybeRow = z.object({
  suggestion_id: z.string(),
  name: z.string().nullable(),
  domain: z.string(),
  reason: z.string().nullable(),
});

const SELECT_COMPETITOR =
  "SELECT id, name, domain, state, state_changed_at, state_reason FROM entity WHERE id = ? AND workspace_id = ? AND role = 'competitor' AND state IN ('on', 'off')";

const SELECT_ENTITY_DOMAIN = "SELECT domain FROM entity WHERE id = ? AND workspace_id = ?";

const readEntityDomainRow = z.object({ domain: z.string() });

const SET_COMPETITOR_STATE =
  "UPDATE entity SET state = ?1, state_changed_at = ?2, state_changed_by = 'user', state_reason = NULL WHERE id = ?3 AND workspace_id = ?4 AND role = 'competitor' AND state IN ('on', 'off') AND state <> ?1 AND (?1 = 'off' OR (SELECT count(*) FROM entity WHERE workspace_id = ?4 AND role = 'competitor' AND state = 'on') < ?5)";

const DELETE_COMPETITOR = "DELETE FROM entity WHERE id = ? AND workspace_id = ? AND role = 'competitor'";

const INSERT_COMPETITOR_FROM_SUGGESTION =
  "INSERT INTO entity (id, workspace_id, role, domain, name, origin, confirmed_at, state, state_changed_at, state_changed_by, created_at) SELECT ?1, workspace_id, 'competitor', candidate_domain, candidate_name, 'auto', ?2, 'on', ?2, 'user', ?2 FROM suggestion WHERE id = ?3 AND workspace_id = ?4 AND status = 'pending' AND (SELECT count(*) FROM entity WHERE workspace_id = ?4 AND role = 'competitor' AND state = 'on' AND domain <> suggestion.candidate_domain) < ?5 ON CONFLICT (workspace_id, domain) DO UPDATE SET state = 'on', state_changed_at = excluded.state_changed_at, state_changed_by = 'user', state_reason = NULL WHERE entity.role = 'competitor' AND entity.state IN ('on', 'off')";

const SELECT_ON =
  "SELECT e.id AS entity_id, e.name, e.domain, s.verdict_reason AS reason FROM entity e LEFT JOIN suggestion s ON s.entity_id = e.id AND s.workspace_id = e.workspace_id WHERE e.workspace_id = ? AND e.role = 'competitor' AND e.state = 'on' ORDER BY e.created_at ASC, e.id ASC";

const SELECT_MAYBE =
  "SELECT id AS suggestion_id, candidate_name AS name, candidate_domain AS domain, verdict_reason AS reason FROM suggestion WHERE workspace_id = ? AND kind = 'add' AND status = 'pending' AND NOT EXISTS (SELECT 1 FROM entity e WHERE e.workspace_id = suggestion.workspace_id AND e.domain = suggestion.candidate_domain AND (e.role <> 'competitor' OR e.state NOT IN ('on', 'off'))) ORDER BY verdict_p IS NULL, verdict_p DESC, created_at ASC";

function displayName(name: string | null, domain: string): string {
  if (name !== null && name !== "") return name;
  return domain;
}

export async function readCompetitor(workspaceId: string, entityId: string): Promise<CompetitorEntity | null> {
  const row = readCompetitorRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_COMPETITOR).bind(entityId, workspaceId).first());
  if (row === null) return null;
  return {
    id: row.id,
    name: row.name ?? row.domain,
    domain: row.domain,
    state: row.state,
    stateChangedAt: row.state_changed_at,
    stateReason: row.state_reason,
  };
}

const SELECT_COMPETITOR_IDENTITY =
  "SELECT identity_json FROM entity WHERE id = ? AND workspace_id = ? AND role = 'competitor' AND json_valid(identity_json)";

const identityJsonRow = z.object({ identity_json: z.string() });

const REPLACE_COMPETITOR_YOUTUBE = `UPDATE entity SET identity_json = json_set(identity_json, '$.socials', json_insert(
  (SELECT json_group_array(json(je.value)) FROM json_each(identity_json, '$.socials') je
   WHERE je.type = 'object' AND CASE WHEN je.type = 'object' THEN json_extract(je.value, '$.platform') END IS NOT 'youtube'),
  '$[#]', json(?3)))
WHERE id = ?1 AND workspace_id = ?2 AND role = 'competitor' AND json_valid(identity_json)
  AND coalesce(json_type(identity_json, '$.socials'), 'array') = 'array'`;

const RESET_YOUTUBE_WATCH =
  "UPDATE watch SET config_json = json_remove(CASE WHEN json_valid(config_json) THEN config_json ELSE '{}' END, '$.channelId', '$.pendingChannelId', '$.degraded', '$.noChannel'), last_polled_at = NULL WHERE entity_id = ?1 AND source_id = 'src_mentions_youtube' AND entity_id IN (SELECT id FROM entity WHERE id = ?1 AND workspace_id = ?2 AND role = 'competitor' AND json_valid(identity_json) AND coalesce(json_type(identity_json, '$.socials'), 'array') = 'array')";

export async function readCompetitorSocials(
  workspaceId: string,
  entityId: string,
): Promise<readonly { platform: string; url: string }[] | null> {
  const row = identityJsonRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_COMPETITOR_IDENTITY).bind(entityId, workspaceId).first());
  if (row === null) return null;
  const parsed = identitySocials.safeParse(JSON.parse(row.identity_json));
  return parsed.success ? (parsed.data.socials ?? []) : null;
}

export async function replaceCompetitorYoutube(input: {
  workspaceId: string;
  entityId: string;
  url: string;
}): Promise<boolean> {
  const { workspaceId, entityId, url } = input;
  const social = JSON.stringify({ platform: "youtube", url });
  const [updated] = await tryWhile(
    () =>
      env.DB.batch([
        env.DB.prepare(REPLACE_COMPETITOR_YOUTUBE).bind(entityId, workspaceId, social),
        env.DB.prepare(RESET_YOUTUBE_WATCH).bind(entityId, workspaceId),
      ]),
    shouldRetryD1,
  );
  return (updated?.meta.changes ?? 0) > 0;
}

export async function readEntityDomain(workspaceId: string, entityId: string): Promise<string | null> {
  const row = readEntityDomainRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_ENTITY_DOMAIN).bind(entityId, workspaceId).first());
  return row?.domain ?? null;
}

export async function setCompetitorState(input: {
  workspaceId: string;
  entityId: string;
  state: CompetitorState;
  now: string;
}): Promise<boolean> {
  const { workspaceId, entityId, state, now } = input;
  const cap = (await readEntitlements(workspaceId)).competitors;
  const result = await tryWhile(
    () => env.DB.prepare(SET_COMPETITOR_STATE).bind(state, now, entityId, workspaceId, cap).run(),
    shouldRetryD1,
  );
  return result.meta.changes === 1;
}

export function deleteCompetitor(workspaceId: string, entityId: string): D1PreparedStatement {
  return env.DB.prepare(DELETE_COMPETITOR).bind(entityId, workspaceId);
}

export async function readOnboardingCompetitors(
  workspaceId: string,
): Promise<{ on: OnCompetitor[]; maybes: MaybeCompetitor[] }> {
  const [onResult, maybeResult] = await Promise.all([
    env.DB.prepare(SELECT_ON).bind(workspaceId).all(),
    env.DB.prepare(SELECT_MAYBE).bind(workspaceId).all(),
  ]);
  const onRows = z.array(onRow).parse(onResult.results);
  const maybeRows = z.array(maybeRow).parse(maybeResult.results);

  const on = onRows.map((row) => ({
    entityId: row.entity_id,
    name: displayName(row.name, row.domain),
    domain: row.domain,
    reason: row.reason,
  }));

  const maybes = maybeRows.map((row) => ({
    suggestionId: row.suggestion_id,
    name: displayName(row.name, row.domain),
    domain: row.domain,
    reason: row.reason,
  }));

  return { on, maybes };
}

export function insertCompetitorFromSuggestion(input: {
  entityId: string;
  now: string;
  suggestionId: string;
  workspaceId: string;
  cap: number;
}): D1PreparedStatement {
  return env.DB.prepare(INSERT_COMPETITOR_FROM_SUGGESTION).bind(
    input.entityId,
    input.now,
    input.suggestionId,
    input.workspaceId,
    input.cap,
  );
}

const INSERT_SELF =
  "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, confirmed_at, state, created_at) VALUES (?1, ?2, 'self', ?3, ?4, ?5, 'manual', ?6, 'on', ?6) ON CONFLICT DO NOTHING";

export async function insertSelfEntity(input: {
  id: string;
  workspaceId: string;
  domain: string;
  name: string;
  identityJson: string;
  now: string;
}): Promise<boolean> {
  const result = await tryWhile(
    () =>
      env.DB.prepare(INSERT_SELF)
        .bind(input.id, input.workspaceId, input.domain, input.name, input.identityJson, input.now)
        .run(),
    shouldRetryD1,
  );
  return result.meta.changes > 0;
}

const SELECT_WORKSPACE_SELF_ID = "SELECT id FROM entity WHERE workspace_id = ?1 AND role = 'self'";

const SELECT_SELF_BY_ID = "SELECT id FROM entity WHERE id = ?1 AND workspace_id = ?2 AND role = 'self'";

const idRow = z.object({ id: z.string() });

export async function readWorkspaceSelfId(workspaceId: string): Promise<string | null> {
  const row = idRow.nullable().parse(await env.DB.prepare(SELECT_WORKSPACE_SELF_ID).bind(workspaceId).first());
  return row === null ? null : row.id;
}

const SELECT_WORKSPACE_ENTITY_IDS = "SELECT id FROM entity WHERE workspace_id = ?1 ORDER BY id";

const workspaceEntityIds = z.array(z.object({ id: z.string() }));

export async function readWorkspaceEntityIds(workspaceId: string): Promise<string[]> {
  const rows = await env.DB.prepare(SELECT_WORKSPACE_ENTITY_IDS).bind(workspaceId).all();
  return workspaceEntityIds.parse(rows.results).map((row) => row.id);
}

export async function readSelfEntityId(workspaceId: string, entityId: string): Promise<string | null> {
  const row = idRow.nullable().parse(await env.DB.prepare(SELECT_SELF_BY_ID).bind(entityId, workspaceId).first());
  return row === null ? null : row.id;
}

export interface DiscoverySelf {
  workspaceId: string;
  name: string;
  domain: string;
  description: string | null;
  kind: "domain" | "creator";
}

export interface DiscoveryContext {
  self: DiscoverySelf;
  competitors: { name: string; domain: string }[];
  knownDomains: string[];
  dismissedDomains: string[];
}

const SELECT_SELF =
  "SELECT workspace_id, name, domain, json_extract(identity_json, '$.description') AS description, json_extract(identity_json, '$.kind') AS kind FROM entity WHERE workspace_id = ? AND role = 'self'";

const SELECT_KNOWN =
  "SELECT domain, name, role, state FROM entity WHERE workspace_id = ?1 UNION ALL SELECT candidate_domain, candidate_name, 'suggestion', status FROM suggestion WHERE workspace_id = ?1 AND status <> 'pending'";

const SELECT_DISCOVERABLE_WORKSPACES =
  "SELECT e.workspace_id AS workspace_id, w.created_at AS created_at, p.status AS status, p.current_period_end AS current_period_end FROM entity e JOIN workspace w ON w.id = e.workspace_id JOIN plan p ON p.workspace_id = w.id WHERE e.role = 'self' AND w.fixture = 0 ORDER BY e.workspace_id";

const readDiscoverableWorkspacesRow = z.object({
  workspace_id: z.string(),
  created_at: z.string(),
  status: z.string(),
  current_period_end: z.string().nullable(),
});

const selfRowSchema = z.object({
  workspace_id: z.string(),
  name: z.string().nullable(),
  domain: z.string(),
  description: z.string().nullable(),
  kind: z.string().nullable(),
});

const knownRow = z.object({
  domain: z.string(),
  name: z.string().nullable(),
  role: z.string(),
  state: z.string(),
});

export async function readDiscoveryContext(workspaceId: string): Promise<DiscoveryContext | null> {
  const [self, known] = await Promise.all([
    env.DB.prepare(SELECT_SELF).bind(workspaceId).first(),
    env.DB.prepare(SELECT_KNOWN).bind(workspaceId).all(),
  ]);
  const selfRow = selfRowSchema.nullable().parse(self);
  if (selfRow === null) return null;
  const rows = z.array(knownRow).parse(known.results);
  return {
    self: {
      workspaceId: selfRow.workspace_id,
      name: displayName(selfRow.name, selfRow.domain),
      domain: selfRow.domain,
      description: selfRow.description,
      kind: selfRow.kind === "channel" || selfRow.kind === "handle" ? "creator" : "domain",
    },
    competitors: rows
      .filter((row) => row.role === "competitor" && row.state === "on")
      .map((row) => ({ name: displayName(row.name, row.domain), domain: row.domain })),
    knownDomains: rows.filter((row) => row.role !== "suggestion").map((row) => row.domain),
    dismissedDomains: rows
      .filter((row) => row.state === "dismissed" || (row.role === "competitor" && row.state === "off"))
      .map((row) => row.domain),
  };
}

interface DiscoverableWorkspace {
  workspaceId: string;
  createdAt: string;
  status: string;
  currentPeriodEnd: string | null;
}

export async function readDiscoverableWorkspaces(): Promise<DiscoverableWorkspace[]> {
  const rows = z
    .array(readDiscoverableWorkspacesRow)
    .parse((await env.DB.prepare(SELECT_DISCOVERABLE_WORKSPACES).all()).results);
  return rows.map((row) => ({
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
  }));
}

const SELECT_REFRESH_TARGETS =
  "SELECT id, name, domain, origin FROM entity WHERE workspace_id = ? AND role = 'competitor' AND state = 'on' ORDER BY created_at ASC, id ASC";

const refreshRow = z.object({
  id: z.string(),
  name: z.string().nullable(),
  domain: z.string(),
  origin: z.enum(["manual", "auto", "seed"]),
});

export async function readRefreshTargets(workspaceId: string): Promise<RefreshTarget[]> {
  const { results } = await env.DB.prepare(SELECT_REFRESH_TARGETS).bind(workspaceId).all();
  return z
    .array(refreshRow)
    .parse(results)
    .map((row) => ({
      entityId: row.id,
      name: displayName(row.name, row.domain),
      domain: row.domain,
      origin: row.origin,
    }));
}

const INSERT_MANUAL_COMPETITOR =
  "INSERT INTO entity (id, workspace_id, role, domain, name, origin, confirmed_at, state, state_changed_at, state_changed_by, created_at, identity_json) SELECT ?1, ?2, 'competitor', ?3, ?4, 'manual', ?5, 'on', ?5, 'user', ?5, CASE WHEN ?7 IS NULL THEN '{}' ELSE json_object('url', ?7) END WHERE (SELECT count(*) FROM entity WHERE workspace_id = ?2 AND role = 'competitor' AND state = 'on' AND domain <> ?3) < ?6 ON CONFLICT (workspace_id, domain) DO UPDATE SET state = 'on', state_changed_at = excluded.state_changed_at, state_changed_by = 'user', state_reason = NULL, identity_json = CASE WHEN ?7 IS NULL THEN entity.identity_json ELSE json_set(entity.identity_json, '$.url', ?7) END WHERE entity.role = 'competitor'";

const COUNT_OTHER_ON =
  "SELECT count(*) AS n FROM entity WHERE workspace_id = ? AND role = 'competitor' AND state = 'on' AND domain <> ?";

const countRow = z.object({ n: z.number() });

export async function countOtherOnCompetitors(workspaceId: string, domain: string): Promise<number | null> {
  const row = countRow.nullable().parse(await env.DB.prepare(COUNT_OTHER_ON).bind(workspaceId, domain).first());
  return row === null ? null : row.n;
}

export async function addManualCompetitor(input: {
  workspaceId: string;
  domain: string;
  name: string | null;
  url: string | null;
  now: string;
  cap: number;
}): Promise<"added" | "at_cap"> {
  const entityId = crypto.randomUUID();
  const result = await tryWhile(
    () =>
      env.DB.prepare(INSERT_MANUAL_COMPETITOR)
        .bind(entityId, input.workspaceId, input.domain, input.name, input.now, input.cap, input.url)
        .run(),
    shouldRetryD1,
  );
  if (result.meta.changes === 1) return "added";
  const count = countRow
    .nullable()
    .parse(await env.DB.prepare(COUNT_OTHER_ON).bind(input.workspaceId, input.domain).first());
  if (count !== null && count.n >= input.cap) return "at_cap";
  return "added";
}

const INSERT_AUTO_COMPETITOR =
  "INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, state_changed_at, state_changed_by, created_at) SELECT ?1, ?2, 'competitor', ?3, ?4, 'auto', 'on', ?5, 'jev', ?5 WHERE EXISTS (SELECT 1 FROM workspace WHERE id = ?2) AND EXISTS (SELECT 1 FROM suggestion WHERE workspace_id = ?2 AND candidate_domain = ?3 AND status = 'auto_on' AND entity_id IS NULL) AND (SELECT count(*) FROM entity WHERE workspace_id = ?2 AND role = 'competitor' AND state = 'on') < ?6 ON CONFLICT (workspace_id, domain) DO NOTHING";

export function insertAutoCompetitor(input: {
  entityId: string;
  workspaceId: string;
  domain: string;
  name: string;
  now: string;
  cap: number;
}): D1PreparedStatement {
  return env.DB.prepare(INSERT_AUTO_COMPETITOR).bind(
    input.entityId,
    input.workspaceId,
    input.domain,
    input.name,
    input.now,
    input.cap,
  );
}

export interface CompetitorRow {
  entityId: string;
  name: string;
  domain: string;
  state: CompetitorState;
  stateChangedAt: string | null;
  reason: string | null;
}

const SELECT_COMPETITORS =
  "SELECT e.id AS entity_id, e.name, e.domain, e.state, e.state_changed_at, s.verdict_reason AS reason FROM entity e LEFT JOIN suggestion s ON s.entity_id = e.id AND s.workspace_id = e.workspace_id WHERE e.workspace_id = ? AND e.role = 'competitor' AND e.state IN ('on', 'off') ORDER BY e.state = 'off', e.origin <> 'manual', CASE WHEN e.origin = 'manual' THEN e.created_at END DESC, e.created_at ASC, e.id ASC";

const competitorDbRow = z.object({
  entity_id: z.string(),
  name: z.string().nullable(),
  domain: z.string(),
  state: z.enum(["on", "off"]),
  state_changed_at: z.string().nullable(),
  reason: z.string().nullable(),
});

const SELECT_RETIRE_QUESTIONS =
  "SELECT s.id AS suggestion_id, e.id AS entity_id, e.name, e.domain, s.verdict_reason AS reason FROM suggestion s JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id WHERE s.workspace_id = ?1 AND s.kind = 'retire' AND s.status = 'pending' AND e.role = 'competitor' AND e.state = 'on' ORDER BY s.created_at ASC, s.id ASC";

const retireQuestionRow = z.object({
  suggestion_id: z.string(),
  entity_id: z.string(),
  name: z.string().nullable(),
  domain: z.string(),
  reason: z.string().nullable(),
});

const TURN_OFF_FROM_RETIRE_SUGGESTION =
  "UPDATE entity SET state = 'off', state_changed_at = ?1, state_changed_by = 'user', state_reason = NULL WHERE workspace_id = ?2 AND role = 'competitor' AND state = 'on' AND id = (SELECT entity_id FROM suggestion WHERE id = ?3 AND workspace_id = ?2 AND kind = 'retire' AND status = 'pending')";

export function turnOffFromRetireSuggestion(input: {
  workspaceId: string;
  suggestionId: string;
  now: string;
}): D1PreparedStatement {
  return env.DB.prepare(TURN_OFF_FROM_RETIRE_SUGGESTION).bind(input.now, input.workspaceId, input.suggestionId);
}

const RETIRE_COMPETITOR_BY_JEV =
  "UPDATE entity SET state = 'off', state_reason = ?1, state_changed_by = 'jev', state_changed_at = ?2 WHERE id = ?3 AND workspace_id = ?4 AND role = 'competitor' AND state = 'on' AND origin = 'auto'";

export function retireCompetitorByJev(input: {
  workspaceId: string;
  entityId: string;
  reason: string;
  now: string;
}): D1PreparedStatement {
  return env.DB.prepare(RETIRE_COMPETITOR_BY_JEV).bind(input.reason, input.now, input.entityId, input.workspaceId);
}

const READ_IDENTITY_JSON = "SELECT identity_json FROM entity WHERE id = ?1 AND workspace_id = ?2";

export async function readEntityIdentityJson(workspaceId: string, entityId: string): Promise<string | null> {
  const row = identityJsonRow
    .nullable()
    .parse(await env.DB.prepare(READ_IDENTITY_JSON).bind(entityId, workspaceId).first());
  return row === null ? null : row.identity_json;
}

export async function readCompetitors(
  workspaceId: string,
): Promise<{ competitors: CompetitorRow[]; maybes: MaybeCompetitor[]; questions: RetireQuestion[] }> {
  const [rows, { maybes }, questions] = await Promise.all([
    env.DB.prepare(SELECT_COMPETITORS).bind(workspaceId).all(),
    readOnboardingCompetitors(workspaceId),
    env.DB.prepare(SELECT_RETIRE_QUESTIONS).bind(workspaceId).all(),
  ]);
  return {
    competitors: z
      .array(competitorDbRow)
      .parse(rows.results)
      .map((row) => ({
        entityId: row.entity_id,
        name: displayName(row.name, row.domain),
        domain: row.domain,
        state: row.state,
        stateChangedAt: row.state_changed_at,
        reason: row.reason,
      })),
    maybes,
    questions: z
      .array(retireQuestionRow)
      .parse(questions.results)
      .map((row) => ({
        suggestionId: row.suggestion_id,
        entityId: row.entity_id,
        name: displayName(row.name, row.domain),
        domain: row.domain,
        reason: row.reason,
      })),
  };
}

const FILL_COMPETITOR_SOCIALS =
  "UPDATE entity SET identity_json = json_set(identity_json, '$.socials', json(?3), '$.socialsReadAt', ?4) WHERE id = ?1 AND workspace_id = ?2 AND role = 'competitor' AND json_valid(identity_json) AND coalesce(json_array_length(identity_json, '$.socials'), 0) = 0";

export async function fillCompetitorSocials(input: {
  workspaceId: string;
  entityId: string;
  socialsJson: string;
  readAt: string;
}): Promise<boolean> {
  const result = await env.DB.prepare(FILL_COMPETITOR_SOCIALS)
    .bind(input.entityId, input.workspaceId, input.socialsJson, input.readAt)
    .run();
  return result.meta.changes === 1;
}

const SITE_FILL_STATES = ["pending", "filled", "gave_up"] as const;

export type SiteFillState = (typeof SITE_FILL_STATES)[number];

const FILL_SELF_SITE_FIELDS =
  "UPDATE entity SET identity_json = json_set(identity_json, '$.description', coalesce(json_extract(identity_json, '$.description'), ?2), '$.socials', CASE WHEN json_array_length(identity_json, '$.socials') > 0 THEN json(json_extract(identity_json, '$.socials')) ELSE json(?3) END, '$.siteFill', 'filled') WHERE id = ?1 AND workspace_id = ?4 AND role = 'self'";

export async function fillSelfSiteFields(input: {
  workspaceId: string;
  entityId: string;
  description: string | null;
  socialsJson: string;
}): Promise<boolean> {
  const result = await env.DB.prepare(FILL_SELF_SITE_FIELDS)
    .bind(input.entityId, input.description, input.socialsJson, input.workspaceId)
    .run();
  return result.meta.changes === 1;
}

const MARK_SELF_SITE_FILL =
  "UPDATE entity SET identity_json = json_set(identity_json, '$.siteFill', ?2) WHERE id = ?1 AND workspace_id = ?3 AND role = 'self'";

export async function markSelfSiteFill(workspaceId: string, entityId: string, state: SiteFillState): Promise<boolean> {
  const result = await env.DB.prepare(MARK_SELF_SITE_FILL).bind(entityId, state, workspaceId).run();
  return result.meta.changes === 1;
}

const READ_SELF_SITE_FILL =
  "SELECT json_extract(identity_json, '$.siteFill') AS site_fill, json_type(identity_json, '$.siteFill') AS site_fill_type FROM entity WHERE workspace_id = ?1 AND role = 'self'";

const siteFillRow = z.object({
  site_fill: z.enum(SITE_FILL_STATES).nullable(),
  site_fill_type: z.literal("text").nullable(),
});

export async function readSelfSiteFill(workspaceId: string): Promise<SiteFillState | null> {
  const row = siteFillRow.nullable().parse(await env.DB.prepare(READ_SELF_SITE_FILL).bind(workspaceId).first());
  return row === null ? null : row.site_fill;
}
