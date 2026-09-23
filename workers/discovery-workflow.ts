import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
	type WorkflowStepConfig,
} from "cloudflare:workers";

import {
	googleNewsRoundups,
	NEWS_GENERATOR,
} from "../app/lib/discovery/generators/news";
import {
	hnCoMentions,
	HN_GENERATOR,
} from "../app/lib/discovery/generators/hn";
import {
	judgeShortlist,
	judgeTracked,
	type D2Outcome,
	type JudgeEnv,
	type JudgedCandidate,
} from "../app/lib/discovery/judge";
import {
	persistDiscovery,
	persistRefresh,
	recordGeneratorSnapshot,
} from "../app/lib/data/discovery.server";
import {
	resolveCandidateDomain,
	type Resolution,
	type ResolverEnv,
} from "../app/lib/discovery/resolve-domain";
import {
	buildShortlist,
	type ScoredCandidate,
} from "../app/lib/discovery/shortlist";
import type { Candidate, DiscoverySubject } from "../app/lib/discovery/types";

export interface DiscoveryParams {
	mode: "create" | "refresh";
	workspaceId: string;
}

type DiscoveryEnv = Pick<
	Env,
	| "DB"
	| "CARD_ARTIFACTS"
	| "RESOLVE_CACHE"
	| "FETCH_SWEEP"
	| "PAGE_SWEEP"
> & {
	JEV_ENDPOINT?: string;
	JEV_KEY?: string;
	JEV_MODEL?: string;
	fetchImpl?: typeof fetch;
};

const STEP_RETRY = {
	retries: { limit: 3, delay: "1 second", backoff: "exponential" },
} satisfies WorkflowStepConfig;
const SWEEP_CHUNK = 100;

interface SelfRow {
	id: string;
	domain: string;
	name: string | null;
	identity_json: string;
}

interface GeneratorRun {
	name: string;
	run: (subject: DiscoverySubject, env: {
		onPayload: (p: { url: string; contentType: string; body: string }) => void;
	}) => Promise<Candidate[]>;
}

const GENERATORS: GeneratorRun[] = [
	{ name: NEWS_GENERATOR, run: googleNewsRoundups },
	{ name: HN_GENERATOR, run: hnCoMentions },
];

async function selfSubject(
	env: DiscoveryEnv,
	workspaceId: string,
): Promise<{ row: SelfRow; subject: DiscoverySubject } | null> {
	const row = await env.DB.prepare(
		"SELECT id, domain, name, identity_json FROM entity WHERE workspace_id = ? AND role = 'self'",
	)
		.bind(workspaceId)
		.first<SelfRow>();
	if (!row) return null;
	let identity: { category?: string; country?: string } = {};
	try {
		identity = JSON.parse(row.identity_json) as typeof identity;
	} catch {
		identity = {};
	}
	return {
		row,
		subject: {
			name: row.name ?? row.domain,
			domain: row.domain,
			category: identity.category ?? null,
			country: identity.country ?? null,
		},
	};
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function putJson(
	env: DiscoveryEnv,
	key: string,
	value: unknown,
): Promise<void> {
	await env.CARD_ARTIFACTS.put(key, JSON.stringify(value), {
		httpMetadata: { contentType: "application/json" },
	});
}

async function getJson<T>(env: DiscoveryEnv, key: string): Promise<T> {
	const object = await env.CARD_ARTIFACTS.get(key);
	if (object === null) throw new Error(`missing ${key}`);
	return object.json<T>();
}

export interface GeneratorsResult {
	candidatesKey: string | null;
	candidateCount: number;
	perGenerator: Record<string, number>;
}

export async function runGeneratorsStep(
	env: DiscoveryEnv,
	workspaceId: string,
	runId: string,
): Promise<GeneratorsResult> {
	const self = await selfSubject(env, workspaceId);
	if (!self) return { candidatesKey: null, candidateCount: 0, perGenerator: {} };
	const prefix = `discovery/${workspaceId}/${runId}`;
	const candidates: Candidate[] = [];
	const perGenerator: Record<string, number> = {};
	const settled = await Promise.allSettled(
		GENERATORS.map((generator) => {
			const payloads: { url: string; contentType: string; body: string }[] = [];
			return generator
				.run(self.subject, {
					fetchImpl: env.fetchImpl,
					onPayload: (p) => payloads.push(p),
				})
				.then(async (list) => {
					const body = JSON.stringify(payloads);
					const r2Key = `${prefix}/payload-${generator.name}.json`;
					await env.CARD_ARTIFACTS.put(r2Key, body, {
						httpMetadata: { contentType: "application/json" },
					});
					return { generator: generator.name, list, r2Key, hash: await sha256Hex(body) };
				});
		}),
	);
	for (const outcome of settled) {
		if (outcome.status !== "fulfilled") continue;
		perGenerator[outcome.value.generator] = outcome.value.list.length;
		candidates.push(...outcome.value.list);
		await recordGeneratorSnapshot(
			{ DB: env.DB },
			workspaceId,
			self.row.id,
			self.row.domain,
			outcome.value.generator,
			outcome.value.list.length,
			outcome.value.r2Key,
			outcome.value.hash,
		);
	}
	const candidatesKey = `${prefix}/candidates.json`;
	await putJson(env, candidatesKey, candidates);
	return { candidatesKey, candidateCount: candidates.length, perGenerator };
}

export async function runCountStep(
	env: DiscoveryEnv,
	candidatesKey: string,
): Promise<{ shortlistKey: string; shortlisted: number; guaranteed: number }> {
	const candidates = await getJson<Candidate[]>(env, candidatesKey);
	const rows = buildShortlist(candidates);
	const shortlistKey = candidatesKey.replace(/candidates\.json$/, "shortlist.json");
	await putJson(env, shortlistKey, rows);
	return {
		shortlistKey,
		shortlisted: rows.filter((r) => r.shortlisted).length,
		guaranteed: rows.filter((r) => r.guaranteedVia !== null).length,
	};
}

export async function runResolveStep(
	env: DiscoveryEnv,
	shortlistKey: string,
): Promise<{ resolutionsKey: string; resolved: number }> {
	const rows = await getJson<ScoredCandidate[]>(env, shortlistKey);
	const resolverEnv: ResolverEnv = { kv: env.RESOLVE_CACHE, fetchImpl: env.fetchImpl };
	const resolutions: Record<string, Resolution> = {};
	let resolved = 0;
	for (const row of rows) {
		if (!row.shortlisted || row.domain !== null) continue;
		const resolution = await resolveCandidateDomain(row.candidate.name, resolverEnv);
		resolutions[row.key] = resolution;
		if (resolution.domain) resolved += 1;
	}
	const resolutionsKey = shortlistKey.replace(/shortlist\.json$/, "resolutions.json");
	await putJson(env, resolutionsKey, resolutions);
	return { resolutionsKey, resolved };
}

function jevEnv(env: DiscoveryEnv): JudgeEnv {
	return {
		DB: env.DB,
		JEV_ENDPOINT: env.JEV_ENDPOINT,
		JEV_KEY: env.JEV_KEY,
		JEV_MODEL: env.JEV_MODEL,
		fetchImpl: env.fetchImpl,
	};
}

export async function runJudgeStep(
	env: DiscoveryEnv,
	workspaceId: string,
	mode: DiscoveryParams["mode"],
	shortlistKey: string,
	resolutionsKey: string,
	prefix: string,
): Promise<{ judgedKey: string; refreshedKey: string | null }> {
	let refreshedKey: string | null = null;
	if (mode === "refresh") {
		const outcomes = await judgeTracked(jevEnv(env), workspaceId);
		refreshedKey = `${prefix}/d2.json`;
		await putJson(env, refreshedKey, outcomes);
	}
	const rows = await getJson<ScoredCandidate[]>(env, shortlistKey);
	const resolutions = new Map(
		Object.entries(await getJson<Record<string, Resolution>>(env, resolutionsKey)),
	);
	const judged = await judgeShortlist(jevEnv(env), workspaceId, rows, resolutions);
	const judgedKey = `${prefix}/judged.json`;
	await putJson(env, judgedKey, judged);
	return { judgedKey, refreshedKey };
}

export interface WriteResult {
	accepted: string[];
	acceptedIds: string[];
	maybe: number;
	dropped: number;
	unjudged: number;
	retired: number;
	asked: number;
}

export async function runWriteStep(
	env: DiscoveryEnv,
	workspaceId: string,
	shortlistKey: string,
	judgedKey: string,
	refreshedKey: string | null,
): Promise<WriteResult> {
	const judged = await getJson<JudgedCandidate[]>(env, judgedKey);
	const allRows = await getJson<ScoredCandidate[]>(env, shortlistKey);
	const result = await persistDiscovery({ DB: env.DB }, workspaceId, judged, allRows);
	let retired = 0;
	let asked = 0;
	if (refreshedKey !== null) {
		const outcomes = await getJson<D2Outcome[]>(env, refreshedKey);
		await persistRefresh({ DB: env.DB }, workspaceId, outcomes);
		retired = outcomes.filter((o) => o.action === "retire").length;
		asked = outcomes.filter((o) => o.action === "ask").length;
	}
	const acceptedIds: string[] = [];
	if (result.accepted.length > 0) {
		const placeholders = result.accepted.map(() => "?").join(",");
		const rows = await env.DB.prepare(
			`SELECT id FROM entity WHERE workspace_id = ? AND domain IN (${placeholders})`,
		)
			.bind(workspaceId, ...result.accepted)
			.all<{ id: string }>();
		acceptedIds.push(...rows.results.map((r) => r.id));
	}
	return { ...result, acceptedIds, retired, asked };
}

export async function runKickSweepsStep(
	env: DiscoveryEnv,
	workspaceId: string,
	acceptedEntityIds: string[],
	tick: string,
): Promise<{ fetch: number; page: number }> {
	const self = await env.DB.prepare(
		"SELECT id FROM entity WHERE workspace_id = ? AND role = 'self'",
	)
		.bind(workspaceId)
		.first<{ id: string }>();
	const clauses: string[] = [];
	const binds: string[] = [];
	if (acceptedEntityIds.length > 0) {
		clauses.push(`w.entity_id IN (${acceptedEntityIds.map(() => "?").join(",")})`);
		binds.push(...acceptedEntityIds);
	}
	if (self) {
		clauses.push("(w.entity_id = ? AND s.kind = 'ads')");
		binds.push(self.id);
	}
	if (clauses.length === 0) return { fetch: 0, page: 0 };
	const rows = await env.DB.prepare(
		`SELECT w.id AS id, s.config_json AS cfg
		 FROM watch w JOIN source s ON s.id = w.source_id
		 WHERE w.is_active = 1 AND s.is_enabled = 1 AND s.key NOT LIKE 'discovery.%'
		   AND (${clauses.join(" OR ")})`,
	)
		.bind(...binds)
		.all<{ id: string; cfg: string }>();
	const fetchBodies: { body: { watchId: string; tick: string; round: 0 } }[] = [];
	const pageBodies: { body: { watchId: string; tick: string; round: 0 } }[] = [];
	for (const row of rows.results) {
		let browser: boolean;
		try {
			browser = (JSON.parse(row.cfg) as { transport?: string }).transport === "browser";
		} catch {
			browser = false;
		}
		const message = { body: { watchId: row.id, tick, round: 0 as const } };
		if (browser) pageBodies.push(message);
		else fetchBodies.push(message);
	}
	for (let i = 0; i < fetchBodies.length; i += SWEEP_CHUNK) {
		await env.FETCH_SWEEP.sendBatch(fetchBodies.slice(i, i + SWEEP_CHUNK));
	}
	for (let i = 0; i < pageBodies.length; i += SWEEP_CHUNK) {
		await env.PAGE_SWEEP.sendBatch(pageBodies.slice(i, i + SWEEP_CHUNK));
	}
	return { fetch: fetchBodies.length, page: pageBodies.length };
}

export class DiscoveryWorkflow extends WorkflowEntrypoint<Env, DiscoveryParams> {
	async run(event: WorkflowEvent<DiscoveryParams>, step: WorkflowStep) {
		const env = this.env as DiscoveryEnv;
		const { mode, workspaceId } = event.payload;
		const tick = event.timestamp.toISOString().slice(0, 10);
		const prefix = `discovery/${workspaceId}/${event.instanceId}`;

		const generated = await step.do("generators", STEP_RETRY, () =>
			runGeneratorsStep(env, workspaceId, event.instanceId),
		);
		if (generated.candidatesKey === null) {
			return { workspaceId, mode, candidates: 0, skipped: "no self entity" };
		}

		const counted = await step.do("count", STEP_RETRY, () =>
			runCountStep(env, generated.candidatesKey),
		);
		const resolved = await step.do("resolve", STEP_RETRY, () =>
			runResolveStep(env, counted.shortlistKey),
		);
		const judged = await step.do("judge", STEP_RETRY, () =>
			runJudgeStep(
				env,
				workspaceId,
				mode,
				counted.shortlistKey,
				resolved.resolutionsKey,
				prefix,
			),
		);
		const written = await step.do("write", STEP_RETRY, () =>
			runWriteStep(env, workspaceId, counted.shortlistKey, judged.judgedKey, judged.refreshedKey),
		);
		const kicked = await step.do("kick-sweeps", STEP_RETRY, () =>
			runKickSweepsStep(env, workspaceId, written.acceptedIds, tick),
		);

		return {
			workspaceId,
			mode,
			candidates: generated.candidateCount,
			shortlisted: counted.shortlisted,
			accepted: written.accepted,
			maybe: written.maybe,
			dropped: written.dropped,
			unjudged: written.unjudged,
			retired: written.retired,
			asked: written.asked,
			kicked,
		};
	}
}
