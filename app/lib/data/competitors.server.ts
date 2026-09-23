import { env } from "cloudflare:workers";
import { getDomain } from "tldts";

import { resolveCandidateDomain } from "../discovery/resolve-domain";
import { normaliseName } from "../discovery/types";
import { setCompetitorStateStmt, upsertTrackedCompetitorStmt } from "./entity.server";
import { discoveryEntityId, idHash } from "./ids.server";
import {
	dismissSuggestionByDomainStmt,
	insertPendingNameSuggestionStmt,
	setSuggestionStatusStmt,
} from "./suggestion.server";
import { setEntityWatchesActiveStmt, watchStatements } from "./watch.server";

export interface CompetitorRow {
	id: string;
	domain: string;
	name: string | null;
	state: string;
	origin: string;
}

export interface SuggestionRow {
	id: string;
	kind: string;
	candidate_domain: string;
	candidate_name: string | null;
	verdict_p: number | null;
	verdict_reason: string | null;
	evidence_json: string;
}

export async function listCompetitors(workspaceId: string) {
	const competitors = await env.DB.prepare(
		`SELECT id, domain, name, state, origin FROM entity
		 WHERE workspace_id = ? AND role = 'competitor' AND state != 'dismissed'
		 ORDER BY CASE WHEN origin = 'manual' THEN 0 ELSE 1 END, created_at DESC`,
	)
		.bind(workspaceId)
		.all<CompetitorRow>();
	const suggestions = await env.DB.prepare(
		`SELECT id, kind, candidate_domain, candidate_name, verdict_p, verdict_reason, evidence_json
		 FROM suggestion
		 WHERE workspace_id = ? AND status = 'pending'
		 ORDER BY created_at DESC`,
	)
		.bind(workspaceId)
		.all<SuggestionRow>();
	return { competitors: competitors.results, suggestions: suggestions.results };
}

async function suggestionId(workspaceId: string, candidateDomain: string): Promise<string> {
	return `sug_${await idHash(workspaceId, candidateDomain)}`;
}

export async function setCompetitorState(
	workspaceId: string,
	entityId: string,
	state: "on" | "off",
): Promise<void> {
	const now = new Date().toISOString();
	await env.DB.batch([
		setCompetitorStateStmt(env.DB, {
			entityId,
			workspaceId,
			state,
			changedBy: "user",
			now,
		}),
		setEntityWatchesActiveStmt(env.DB, entityId, state === "on"),
	]);
}

export async function dismissCompetitor(
	workspaceId: string,
	entityId: string,
): Promise<void> {
	const now = new Date().toISOString();
	const entity = await env.DB.prepare(
		"SELECT domain FROM entity WHERE id = ? AND workspace_id = ? AND role = 'competitor'",
	)
		.bind(entityId, workspaceId)
		.first<{ domain: string }>();
	if (!entity) return;
	await env.DB.batch([
		setCompetitorStateStmt(env.DB, {
			entityId,
			workspaceId,
			state: "dismissed",
			changedBy: "user",
			now,
		}),
		setEntityWatchesActiveStmt(env.DB, entityId, false),
		dismissSuggestionByDomainStmt(env.DB, {
			id: await suggestionId(workspaceId, entity.domain),
			workspaceId,
			domain: entity.domain,
			now,
		}),
	]);
}

export async function dismissSuggestion(
	workspaceId: string,
	suggestionIdValue: string,
): Promise<void> {
	await setSuggestionStatusStmt(env.DB, {
		id: suggestionIdValue,
		workspaceId,
		status: "dismissed",
		now: new Date().toISOString(),
	}).run();
}

async function acceptDomain(
	workspaceId: string,
	domain: string,
	name: string | null,
	origin: "manual" | "auto",
): Promise<void> {
	const now = new Date().toISOString();
	const entityId = await discoveryEntityId(workspaceId, domain);
	const stmts = [
		upsertTrackedCompetitorStmt(env.DB, {
			id: entityId,
			workspaceId,
			domain,
			name,
			origin,
			now,
		}),
		setEntityWatchesActiveStmt(env.DB, entityId, true),
		...(await watchStatements(env.DB, entityId, domain)),
	];
	await env.DB.batch(stmts);
}

export async function acceptSuggestion(
	workspaceId: string,
	suggestionIdValue: string,
): Promise<{ accepted: boolean }> {
	const suggestion = await env.DB.prepare(
		`SELECT candidate_domain, candidate_name FROM suggestion
		 WHERE id = ? AND workspace_id = ? AND status = 'pending'`,
	)
		.bind(suggestionIdValue, workspaceId)
		.first<{ candidate_domain: string; candidate_name: string | null }>();
	if (!suggestion) return { accepted: false };
	let domain = suggestion.candidate_domain.startsWith("name:")
		? null
		: suggestion.candidate_domain;
	if (domain === null) {
		const name = suggestion.candidate_name ?? suggestion.candidate_domain.slice(5);
		const resolution = await resolveCandidateDomain(name, { kv: env.RESOLVE_CACHE });
		domain = resolution.domain;
	}
	if (domain === null) return { accepted: false };
	await acceptDomain(workspaceId, domain, suggestion.candidate_name, "auto");
	await setSuggestionStatusStmt(env.DB, {
		id: suggestionIdValue,
		workspaceId,
		status: "accepted",
		now: new Date().toISOString(),
	}).run();
	return { accepted: true };
}

export async function addCompetitor(
	workspaceId: string,
	input: string,
): Promise<{ domain: string | null; pending: string | null }> {
	const trimmed = input.trim();
	if (!trimmed) return { domain: null, pending: null };
	const host = trimmed.replace(/^https?:\/\//i, "").split(/[/?#\s]/)[0] ?? "";
	const asDomain = host.includes(".") ? getDomain(`https://${host}`) : null;
	if (asDomain) {
		await acceptDomain(workspaceId, asDomain, null, "manual");
		return { domain: asDomain, pending: null };
	}
	const resolution = await resolveCandidateDomain(trimmed, { kv: env.RESOLVE_CACHE });
	if (resolution.domain) {
		await acceptDomain(workspaceId, resolution.domain, trimmed, "manual");
		return { domain: resolution.domain, pending: null };
	}
	const candidateDomain = `name:${normaliseName(trimmed)}`;
	await insertPendingNameSuggestionStmt(env.DB, {
		id: await suggestionId(workspaceId, candidateDomain),
		workspaceId,
		domain: candidateDomain,
		name: trimmed,
		now: new Date().toISOString(),
	}).run();
	return { domain: null, pending: trimmed };
}
