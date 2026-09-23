import { env } from "cloudflare:workers";
import { getDomain } from "tldts";

import { discoveryEntityId, watchStatements } from "../discovery/persist";
import { resolveCandidateDomain } from "../discovery/resolve-domain";
import { normaliseName } from "../discovery/types";

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
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`${workspaceId}:${candidateDomain}`),
	);
	return `sug_${[...new Uint8Array(digest)]
		.slice(0, 12)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")}`;
}

export async function setCompetitorState(
	workspaceId: string,
	entityId: string,
	state: "on" | "off",
): Promise<void> {
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(
			`UPDATE entity SET state = ?, state_changed_by = 'user', state_changed_at = ?
			 WHERE id = ? AND workspace_id = ? AND role = 'competitor'`,
		).bind(state, now, entityId, workspaceId),
		env.DB.prepare(
			"UPDATE watch SET is_active = ? WHERE entity_id = ?",
		).bind(state === "on" ? 1 : 0, entityId),
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
		env.DB.prepare(
			`UPDATE entity SET state = 'dismissed', state_changed_by = 'user', state_changed_at = ?
			 WHERE id = ?`,
		).bind(now, entityId),
		env.DB.prepare("UPDATE watch SET is_active = 0 WHERE entity_id = ?").bind(entityId),
		env.DB.prepare(
			`INSERT INTO suggestion
			   (id, workspace_id, kind, candidate_domain, status, decided_by, decided_at, created_at)
			 VALUES (?, ?, 'add', ?, 'dismissed', 'user', ?, ?)
			 ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
			   status = 'dismissed', decided_by = 'user', decided_at = excluded.decided_at`,
		).bind(await suggestionId(workspaceId, entity.domain), workspaceId, entity.domain, now, now),
	]);
}

export async function dismissSuggestion(
	workspaceId: string,
	suggestionIdValue: string,
): Promise<void> {
	await env.DB.prepare(
		`UPDATE suggestion SET status = 'dismissed', decided_by = 'user', decided_at = ?
		 WHERE id = ? AND workspace_id = ?`,
	)
		.bind(new Date().toISOString(), suggestionIdValue, workspaceId)
		.run();
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
		env.DB.prepare(
			`INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, created_at)
			 VALUES (?, ?, 'competitor', ?, ?, ?, 'on', ?)
			 ON CONFLICT(workspace_id, domain) DO UPDATE SET
			   state = 'on', state_changed_by = 'user', state_changed_at = excluded.created_at`,
		).bind(entityId, workspaceId, domain, name, origin, now),
		env.DB.prepare("UPDATE watch SET is_active = 1 WHERE entity_id = ?").bind(entityId),
	];
	stmts.push(...(await watchStatements(env.DB, entityId, domain)));
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
	await env.DB.prepare(
		`UPDATE suggestion SET status = 'accepted', decided_by = 'user', decided_at = ?
		 WHERE id = ?`,
	)
		.bind(new Date().toISOString(), suggestionIdValue)
		.run();
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
	await env.DB.prepare(
		`INSERT OR IGNORE INTO suggestion
		   (id, workspace_id, kind, candidate_domain, candidate_name, status, created_at)
		 VALUES (?, ?, 'add', ?, ?, 'pending', ?)`,
	)
		.bind(
			await suggestionId(workspaceId, candidateDomain),
			workspaceId,
			candidateDomain,
			trimmed,
			new Date().toISOString(),
		)
		.run();
	return { domain: null, pending: trimmed };
}
