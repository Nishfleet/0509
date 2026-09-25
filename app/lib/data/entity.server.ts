import { env } from "cloudflare:workers";

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

interface Row {
  id: string;
  name: string | null;
  domain: string;
  state: CompetitorState;
  state_changed_at: string | null;
  state_reason: string | null;
}

export interface RetireQuestion {
  suggestionId: string;
  entityId: string;
  name: string;
  domain: string;
  reason: string | null;
}

interface OnRow {
  entity_id: string;
  name: string | null;
  domain: string;
  reason: string | null;
}

interface MaybeRow {
  suggestion_id: string;
  name: string | null;
  domain: string;
  reason: string | null;
}

const SELECT_COMPETITOR =
  "SELECT id, name, domain, state, state_changed_at, state_reason FROM entity WHERE id = ? AND workspace_id = ? AND role = 'competitor' AND state IN ('on', 'off')";

const SELECT_ENTITY_DOMAIN = "SELECT domain FROM entity WHERE id = ? AND workspace_id = ?";

const SET_COMPETITOR_STATE =
  "UPDATE entity SET state = ?, state_changed_at = ?, state_changed_by = 'user', state_reason = NULL WHERE id = ? AND workspace_id = ? AND role = 'competitor' AND state IN ('on', 'off') AND state <> ?";

const INSERT_COMPETITOR_FROM_SUGGESTION =
  "INSERT INTO entity (id, workspace_id, role, domain, name, origin, confirmed_at, state, state_changed_at, state_changed_by, created_at) SELECT ?1, workspace_id, 'competitor', candidate_domain, candidate_name, 'auto', ?2, 'on', ?2, 'user', ?2 FROM suggestion WHERE id = ?3 AND workspace_id = ?4 AND status = 'pending' ON CONFLICT (workspace_id, domain) DO UPDATE SET state = 'on', state_changed_at = excluded.state_changed_at, state_changed_by = 'user', state_reason = NULL WHERE entity.role = 'competitor' AND entity.state IN ('on', 'off')";

const SELECT_ON =
  "SELECT e.id AS entity_id, e.name, e.domain, s.verdict_reason AS reason FROM entity e LEFT JOIN suggestion s ON s.entity_id = e.id AND s.workspace_id = e.workspace_id WHERE e.workspace_id = ? AND e.role = 'competitor' AND e.state = 'on' ORDER BY e.created_at ASC, e.id ASC";

const SELECT_MAYBE =
  "SELECT id AS suggestion_id, candidate_name AS name, candidate_domain AS domain, verdict_reason AS reason FROM suggestion WHERE workspace_id = ? AND kind = 'add' AND status = 'pending' AND NOT EXISTS (SELECT 1 FROM entity e WHERE e.workspace_id = suggestion.workspace_id AND e.domain = suggestion.candidate_domain AND (e.role <> 'competitor' OR e.state NOT IN ('on', 'off'))) ORDER BY verdict_p IS NULL, verdict_p DESC, created_at ASC";

function displayName(name: string | null, domain: string): string {
  if (name !== null && name !== "") return name;
  return domain;
}

export async function readCompetitor(
  workspaceId: string,
  entityId: string,
): Promise<CompetitorEntity | null> {
  const row = await env.DB.prepare(SELECT_COMPETITOR).bind(entityId, workspaceId).first<Row>();
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

export async function readEntityDomain(workspaceId: string, entityId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_ENTITY_DOMAIN).bind(entityId, workspaceId).first<{ domain: string }>();
  return row?.domain ?? null;
}

export async function setCompetitorState(
  workspaceId: string,
  entityId: string,
  state: CompetitorState,
  now: string,
): Promise<boolean> {
  const result = await env.DB.prepare(SET_COMPETITOR_STATE)
    .bind(state, now, entityId, workspaceId, state)
    .run();
  return result.meta.changes === 1;
}

export async function readOnboardingCompetitors(
  workspaceId: string,
): Promise<{ on: OnCompetitor[]; maybes: MaybeCompetitor[] }> {
  const [onResult, maybeResult] = await Promise.all([
    env.DB.prepare(SELECT_ON).bind(workspaceId).all<OnRow>(),
    env.DB.prepare(SELECT_MAYBE).bind(workspaceId).all<MaybeRow>(),
  ]);

  const on = onResult.results.map((row) => ({
    entityId: row.entity_id,
    name: displayName(row.name, row.domain),
    domain: row.domain,
    reason: row.reason,
  }));

  const maybes = maybeResult.results.map((row) => ({
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
}): D1PreparedStatement {
  return env.DB
    .prepare(INSERT_COMPETITOR_FROM_SUGGESTION)
    .bind(input.entityId, input.now, input.suggestionId, input.workspaceId);
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
}): Promise<void> {
  await env.DB.prepare(INSERT_SELF)
    .bind(input.id, input.workspaceId, input.domain, input.name, input.identityJson, input.now)
    .run();
}

const SELECT_WORKSPACE_SELF_ID = "SELECT id FROM entity WHERE workspace_id = ?1 AND role = 'self'";

const SELECT_SELF_BY_ID =
  "SELECT id FROM entity WHERE id = ?1 AND workspace_id = ?2 AND role = 'self'";

export async function readWorkspaceSelfId(workspaceId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_WORKSPACE_SELF_ID).bind(workspaceId).first<{ id: string }>();
  return row?.id ?? null;
}

export async function readSelfEntityId(workspaceId: string, entityId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_SELF_BY_ID).bind(entityId, workspaceId).first<{ id: string }>();
  return row?.id ?? null;
}

export interface DiscoverySelf {
  workspaceId: string;
  name: string;
  domain: string;
  description: string | null;
}

export interface DiscoveryContext {
  self: DiscoverySelf;
  competitors: { name: string; domain: string }[];
  knownDomains: string[];
  dismissedDomains: string[];
}

const SELECT_SELF =
  "SELECT workspace_id, name, domain, json_extract(identity_json, '$.description') AS description FROM entity WHERE workspace_id = ? AND role = 'self'";

const SELECT_KNOWN =
  "SELECT domain, name, role, state FROM entity WHERE workspace_id = ?1 UNION ALL SELECT candidate_domain, candidate_name, 'suggestion', status FROM suggestion WHERE workspace_id = ?1 AND status <> 'pending'";

const SELECT_SELF_WORKSPACES = "SELECT workspace_id FROM entity WHERE role = 'self' ORDER BY workspace_id";

interface SelfRow {
  workspace_id: string;
  name: string | null;
  domain: string;
  description: string | null;
}

interface KnownRow {
  domain: string;
  name: string | null;
  role: string;
  state: string;
}

export async function readDiscoveryContext(workspaceId: string): Promise<DiscoveryContext | null> {
  const [selfRow, known] = await Promise.all([
    env.DB.prepare(SELECT_SELF).bind(workspaceId).first<SelfRow>(),
    env.DB.prepare(SELECT_KNOWN).bind(workspaceId).all<KnownRow>(),
  ]);
  if (selfRow === null) return null;
  const rows = known.results;
  return {
    self: {
      workspaceId: selfRow.workspace_id,
      name: displayName(selfRow.name, selfRow.domain),
      domain: selfRow.domain,
      description: selfRow.description,
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

export async function readSelfWorkspaceIds(): Promise<string[]> {
  const rows = await env.DB.prepare(SELECT_SELF_WORKSPACES).all<{ workspace_id: string }>();
  return rows.results.map((row) => row.workspace_id);
}

const SELECT_REFRESH_TARGETS =
  "SELECT id, name, domain, origin FROM entity WHERE workspace_id = ? AND role = 'competitor' AND state = 'on' ORDER BY created_at ASC, id ASC";

interface RefreshRow {
  id: string;
  name: string | null;
  domain: string;
  origin: EntityOrigin;
}

export async function readRefreshTargets(workspaceId: string): Promise<RefreshTarget[]> {
  const { results } = await env.DB.prepare(SELECT_REFRESH_TARGETS).bind(workspaceId).all<RefreshRow>();
  return results.map((row) => ({
    entityId: row.id,
    name: displayName(row.name, row.domain),
    domain: row.domain,
    origin: row.origin,
  }));
}

const INSERT_MANUAL_COMPETITOR =
  "INSERT INTO entity (id, workspace_id, role, domain, name, origin, confirmed_at, state, state_changed_at, state_changed_by, created_at) SELECT ?1, ?2, 'competitor', ?3, ?4, 'manual', ?5, 'on', ?5, 'user', ?5 WHERE (SELECT count(*) FROM entity WHERE workspace_id = ?2 AND role = 'competitor' AND state = 'on' AND domain <> ?3) < ?6 ON CONFLICT (workspace_id, domain) DO UPDATE SET state = 'on', state_changed_at = excluded.state_changed_at, state_changed_by = 'user', state_reason = NULL WHERE entity.role = 'competitor'";

const COUNT_OTHER_ON =
  "SELECT count(*) AS n FROM entity WHERE workspace_id = ? AND role = 'competitor' AND state = 'on' AND domain <> ?";

export async function addManualCompetitor(input: {
  workspaceId: string;
  domain: string;
  name: string | null;
  now: string;
  cap: number;
}): Promise<"added" | "at_cap"> {
  const result = await env.DB.prepare(INSERT_MANUAL_COMPETITOR)
    .bind(crypto.randomUUID(), input.workspaceId, input.domain, input.name, input.now, input.cap)
    .run();
  if (result.meta.changes === 1) return "added";
  const count = await env.DB.prepare(COUNT_OTHER_ON)
    .bind(input.workspaceId, input.domain)
    .first<{ n: number }>();
  if (count !== null && count.n >= input.cap) return "at_cap";
  return "added";
}

const INSERT_AUTO_COMPETITOR =
  "INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, state_changed_at, state_changed_by, created_at) SELECT ?1, ?2, 'competitor', ?3, ?4, 'auto', 'on', ?5, 'jev', ?5 WHERE EXISTS (SELECT 1 FROM suggestion WHERE workspace_id = ?2 AND candidate_domain = ?3 AND status = 'auto_on' AND entity_id IS NULL) ON CONFLICT (workspace_id, domain) DO NOTHING";

export function insertAutoCompetitor(input: {
  entityId: string;
  workspaceId: string;
  domain: string;
  name: string;
  now: string;
}): D1PreparedStatement {
  return env.DB.prepare(INSERT_AUTO_COMPETITOR).bind(
    input.entityId,
    input.workspaceId,
    input.domain,
    input.name,
    input.now,
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

interface CompetitorDbRow {
  entity_id: string;
  name: string | null;
  domain: string;
  state: CompetitorState;
  state_changed_at: string | null;
  reason: string | null;
}

const SELECT_RETIRE_QUESTIONS =
  "SELECT s.id AS suggestion_id, e.id AS entity_id, e.name, e.domain, s.verdict_reason AS reason FROM suggestion s JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id WHERE s.workspace_id = ?1 AND s.kind = 'retire' AND s.status = 'pending' AND e.role = 'competitor' AND e.state = 'on' ORDER BY s.created_at ASC, s.id ASC";

interface RetireQuestionRow {
  suggestion_id: string;
  entity_id: string;
  name: string | null;
  domain: string;
  reason: string | null;
}

const TURN_OFF_FROM_RETIRE_SUGGESTION =
  "UPDATE entity SET state = 'off', state_changed_at = ?1, state_changed_by = 'user', state_reason = NULL WHERE workspace_id = ?2 AND role = 'competitor' AND state = 'on' AND id = (SELECT entity_id FROM suggestion WHERE id = ?3 AND workspace_id = ?2 AND kind = 'retire' AND status = 'pending')";

export function turnOffFromRetireSuggestion(input: {
  workspaceId: string;
  suggestionId: string;
  now: string;
}): D1PreparedStatement {
  return env.DB
    .prepare(TURN_OFF_FROM_RETIRE_SUGGESTION)
    .bind(input.now, input.workspaceId, input.suggestionId);
}

const RETIRE_COMPETITOR_BY_JEV =
  "UPDATE entity SET state = 'off', state_reason = ?1, state_changed_by = 'jev', state_changed_at = ?2 WHERE id = ?3 AND workspace_id = ?4 AND role = 'competitor' AND state = 'on' AND origin = 'auto'";

export function retireCompetitorByJev(input: {
  workspaceId: string;
  entityId: string;
  reason: string;
  now: string;
}): D1PreparedStatement {
  return env.DB
    .prepare(RETIRE_COMPETITOR_BY_JEV)
    .bind(input.reason, input.now, input.entityId, input.workspaceId);
}

const READ_IDENTITY_JSON = "SELECT identity_json FROM entity WHERE id = ?1";

export async function readEntityIdentityJson(entityId: string): Promise<string | null> {
  const row = await env.DB.prepare(READ_IDENTITY_JSON).bind(entityId).first<{ identity_json: string }>();
  return row === null ? null : row.identity_json;
}

export async function readCompetitors(
  workspaceId: string,
): Promise<{ competitors: CompetitorRow[]; maybes: MaybeCompetitor[]; questions: RetireQuestion[] }> {
  const [rows, { maybes }, questions] = await Promise.all([
    env.DB.prepare(SELECT_COMPETITORS).bind(workspaceId).all<CompetitorDbRow>(),
    readOnboardingCompetitors(workspaceId),
    env.DB.prepare(SELECT_RETIRE_QUESTIONS).bind(workspaceId).all<RetireQuestionRow>(),
  ]);
  return {
    competitors: rows.results.map((row) => ({
      entityId: row.entity_id,
      name: displayName(row.name, row.domain),
      domain: row.domain,
      state: row.state,
      stateChangedAt: row.state_changed_at,
      reason: row.reason,
    })),
    maybes,
    questions: questions.results.map((row) => ({
      suggestionId: row.suggestion_id,
      entityId: row.entity_id,
      name: displayName(row.name, row.domain),
      domain: row.domain,
      reason: row.reason,
    })),
  };
}

export type SiteFillState = "pending" | "filled" | "gave_up";

const FILL_SELF_SITE_FIELDS =
  "UPDATE entity SET identity_json = json_set(identity_json, '$.description', coalesce(json_extract(identity_json, '$.description'), ?2), '$.socials', CASE WHEN json_array_length(identity_json, '$.socials') > 0 THEN json(json_extract(identity_json, '$.socials')) ELSE json(?3) END, '$.siteFill', 'filled') WHERE id = ?1 AND role = 'self'";

export async function fillSelfSiteFields(input: {
  entityId: string;
  description: string | null;
  socialsJson: string;
}): Promise<void> {
  await env.DB.prepare(FILL_SELF_SITE_FIELDS).bind(input.entityId, input.description, input.socialsJson).run();
}

const MARK_SELF_SITE_FILL =
  "UPDATE entity SET identity_json = json_set(identity_json, '$.siteFill', ?2) WHERE id = ?1 AND role = 'self'";

export async function markSelfSiteFill(entityId: string, state: SiteFillState): Promise<void> {
  await env.DB.prepare(MARK_SELF_SITE_FILL).bind(entityId, state).run();
}

const READ_SELF_SITE_FILL =
  "SELECT json_extract(identity_json, '$.siteFill') AS site_fill FROM entity WHERE workspace_id = ?1 AND role = 'self'";

export async function readSelfSiteFill(workspaceId: string): Promise<SiteFillState | null> {
  const row = await env.DB.prepare(READ_SELF_SITE_FILL).bind(workspaceId).first<{ site_fill: string | null }>();
  const value = row?.site_fill ?? null;
  return value === "pending" || value === "filled" || value === "gave_up" ? value : null;
}
