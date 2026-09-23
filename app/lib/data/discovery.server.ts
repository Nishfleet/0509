import { D1_QUESTION, D2_QUESTION, excludedDomains } from "../discovery/judge";
import type { D2Outcome, JudgedCandidate } from "../discovery/judge";
import type { ScoredCandidate } from "../discovery/shortlist";
import { normaliseName } from "../discovery/types";
import { insertCompetitorEntityStmt, retireCompetitorStmt } from "./entity.server";
import { idHash } from "./ids.server";
import { insertVerdictStmt } from "./jev_verdict.server";
import { insertSnapshotStmt } from "./snapshot.server";
import {
	insertUnjudgedSuggestionStmt,
	upsertAcceptedSuggestionStmt,
	upsertDroppedSuggestionStmt,
	upsertMaybeSuggestionStmt,
	upsertRetireAskStmt,
} from "./suggestion.server";
import { insertWatchStmt, watchStatements } from "./watch.server";

export interface PersistEnv {
	DB: D1Database;
}

export interface PersistResult {
	accepted: string[];
	maybe: number;
	dropped: number;
	unjudged: number;
}

function evidenceJson(scored: ScoredCandidate): string {
	return JSON.stringify({
		generator_count: scored.generatorCount,
		publisher_count: scored.publisherCount,
		guaranteed_via: scored.guaranteedVia,
		lines: scored.candidate.evidence.map((e) => ({
			generator: e.generator,
			source_url: e.sourceUrl,
			excerpt: e.excerpt.slice(0, 200),
			publisher_domain: e.publisherDomain ?? null,
		})),
	});
}

export async function persistDiscovery(
	env: PersistEnv,
	workspaceId: string,
	judged: JudgedCandidate[],
	allRows: ScoredCandidate[],
): Promise<PersistResult> {
	const now = new Date().toISOString();
	const judgedKeys = new Set(judged.map((j) => j.scored.key));
	const stmts: D1PreparedStatement[] = [];
	const result: PersistResult = { accepted: [], maybe: 0, dropped: 0, unjudged: 0 };

	for (const j of judged) {
		const candidateDomain = j.domain ?? `name:${normaliseName(j.scored.candidate.name)}`;
		const suggestionId = `sug_${await idHash(workspaceId, candidateDomain)}`;
		const evidence = evidenceJson(j.scored);
		if (j.decision === "accept" && j.domain) {
			const entityId = `ent_${await idHash(workspaceId, j.domain)}`;
			result.accepted.push(j.domain);
			stmts.push(
				insertCompetitorEntityStmt(env.DB, {
					id: entityId,
					workspaceId,
					domain: j.domain,
					name: j.scored.candidate.name,
					origin: "auto",
					now,
				}),
				...(await watchStatements(env.DB, entityId, j.domain)),
				upsertAcceptedSuggestionStmt(env.DB, {
					id: suggestionId,
					workspaceId,
					entityId,
					domain: candidateDomain,
					name: j.scored.candidate.name,
					evidenceJson: evidence,
					p: j.p,
					reason: j.verdictReason,
					now,
				}),
			);
		} else if (j.decision === "drop") {
			result.dropped += 1;
			stmts.push(
				upsertDroppedSuggestionStmt(env.DB, {
					id: suggestionId,
					workspaceId,
					entityId: null,
					domain: candidateDomain,
					name: j.scored.candidate.name,
					evidenceJson: evidence,
					p: j.p,
					reason: j.verdictReason ?? "below the drop threshold",
					now,
				}),
			);
		} else {
			result.maybe += 1;
			stmts.push(
				upsertMaybeSuggestionStmt(env.DB, {
					id: suggestionId,
					workspaceId,
					entityId: null,
					domain: candidateDomain,
					name: j.scored.candidate.name,
					evidenceJson: evidence,
					p: j.p,
					reason: j.verdictReason,
					decidedBy: j.judged ? "jev" : null,
					decidedAt: j.judged ? now : null,
					now,
				}),
			);
		}
		if (j.judged) {
			stmts.push(
				insertVerdictStmt(env.DB, {
					id: `jev_${await idHash(D1_QUESTION, j.inputHash)}`,
					workspaceId,
					questionId: D1_QUESTION,
					inputHash: j.inputHash,
					entityId: j.decision === "accept" && j.domain ? `ent_${await idHash(workspaceId, j.domain)}` : null,
					p: j.p,
					choice: null,
					reason: j.verdictReason,
					now,
				}),
			);
		}
	}

	const excluded = await excludedDomains({ DB: env.DB }, workspaceId);
	for (const row of allRows) {
		if (judgedKeys.has(row.key)) continue;
		const candidateDomain = row.domain ?? `name:${normaliseName(row.candidate.name)}`;
		if (excluded.has(candidateDomain)) continue;
		result.unjudged += 1;
		stmts.push(
			insertUnjudgedSuggestionStmt(env.DB, {
				id: `sug_${await idHash(workspaceId, candidateDomain)}`,
				workspaceId,
				domain: candidateDomain,
				name: row.candidate.name,
				evidenceJson: evidenceJson(row),
				now,
			}),
		);
	}

	if (stmts.length > 0) await env.DB.batch(stmts);
	return result;
}

export async function persistRefresh(
	env: PersistEnv,
	workspaceId: string,
	outcomes: D2Outcome[],
): Promise<void> {
	const now = new Date().toISOString();
	const stmts: D1PreparedStatement[] = [];
	for (const o of outcomes) {
		if (o.action === "unjudged") continue;
		const reason = o.action === "retire" || o.action === "ask" ? o.reason : null;
		stmts.push(
			insertVerdictStmt(env.DB, {
				id: `jev_${await idHash(D2_QUESTION, o.inputHash)}`,
				workspaceId,
				questionId: D2_QUESTION,
				inputHash: o.inputHash,
				entityId: o.entityId,
				p: o.p,
				choice: reason,
				reason,
				now,
			}),
		);
		if (o.action === "retire") {
			stmts.push(
				retireCompetitorStmt(env.DB, {
					entityId: o.entityId,
					workspaceId,
					reason: o.reason,
					now,
				}),
			);
		}
		if (o.action === "ask") {
			stmts.push(
				upsertRetireAskStmt(env.DB, {
					id: `sug_${await idHash(workspaceId, `retire:${o.domain}`)}`,
					workspaceId,
					entityId: o.entityId,
					domain: o.domain,
					p: o.p,
					reason: o.reason,
					now,
				}),
			);
		}
	}
	if (stmts.length > 0) await env.DB.batch(stmts);
}

export async function recordGeneratorSnapshot(
	env: PersistEnv,
	workspaceId: string,
	selfEntityId: string,
	selfDomain: string,
	generator: string,
	itemCount: number,
	payloadR2Key: string | null,
	payloadHash: string,
): Promise<void> {
	const now = new Date().toISOString();
	const source = await env.DB.prepare("SELECT id FROM source WHERE plugin_key = ?")
		.bind(generator)
		.first<{ id: string }>();
	if (!source) return;
	const watchId = `wat_${await idHash(selfEntityId, source.id, selfDomain)}`;
	await env.DB.batch([
		insertWatchStmt(env.DB, {
			id: watchId,
			entityId: selfEntityId,
			sourceId: source.id,
			targetKey: selfDomain,
		}),
		insertSnapshotStmt(env.DB, {
			id: `snp_${await idHash(watchId, now, generator)}`,
			watchId,
			fetchedAt: now,
			payloadR2Key,
			payloadHash,
			itemCount,
		}),
	]);
}
