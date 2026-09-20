/**
 * Jev advisory scoring for digest candidates (issue #3539, epic #3530).
 *
 * One batched `env.AI.run("typesafe/jev", {state, questions})` call per digest
 * run scores every candidate item: a `worth_telling` noul plus a `significance`
 * 0-3 score (the issue's `worth_alert`). Answers land in the additive
 * `digest_item_jev_score` evidence table beside the heuristic `priorityScore`
 * the cohort ranked on.
 *
 * This module is MEASUREMENT ONLY, same posture as the input screen
 * (`input-screen-jev.server.ts`): it decides nothing, reorders nothing, and
 * suppresses nothing. The caller's cohort, ordering and delivery eligibility
 * are untouched; every failure — no flag, no binding, unpaid gateway, timeout,
 * malformed answer — degrades to a log line and today's behaviour. The flip
 * from advisory to enforcement belongs to Nishfleet/0509#3531's benchmark go
 * row, not to this module.
 *
 * The unpaid-gateway 402 the input screen measured (docs/jev-input-screen-
 * 2026-09.md §1) applies here too: the first insufficient-balance answer opens
 * an isolate-scoped circuit so later digest runs in this isolate skip instead
 * of stacking 402s onto the digest path.
 */

import {
	isUnpaidWorkersAiJev,
	stableJson,
} from "~/lib/input-screen-jev.server";
// Type-only: the runtime lookup stays behind a dynamic import in
// `defaultPersistDigestItemJevScores`, so strict-mock `~/lib/data.server`
// adapters without this export degrade inside the shadow's try/catch instead
// of failing the module graph at import time.
import type { DigestItemJevScoreInput } from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import { promiseWithTimeout } from "~/lib/fetch-timeout.server";

/** Shared site name for every evidence row and log line. */
export const DIGEST_ALERTS_SITE = "digest-alerts";

/** Issue whose acceptance this measurement serves. */
export const DIGEST_ALERTS_ISSUE_REF = "Nishfleet/0509#3539";

/** Workers AI binding model id (same binding the input screen uses). */
export const DIGEST_ALERTS_MODEL = "typesafe/jev";

/**
 * Upper bound on scored candidates per run — the digest cohort cap. The
 * candidate list arrives in the same stable order the cohort was selected
 * from, so the slice keeps every delivered item first.
 */
export const DIGEST_ALERTS_MAX_ITEMS = 150;

/** Hard cap on the batched call so advisory work cannot outlive the digest. */
export const DIGEST_ALERTS_TIMEOUT_MS = 20_000;

/**
 * Provisional would-suppress floor: an in-cohort item scoring below this
 * noul probability is one Jev would have left out of the email. Code's
 * number, advisory only — re-deriving from stored rows costs no API call.
 */
export const DIGEST_ALERTS_WOULD_SUPPRESS_BELOW = 0.5;

const JEV_ALERTS_ENABLE_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * The per-site rollback flag (issue rails: `JEV_<SITE>`, off restores prior
 * behaviour). Absent or any unlisted value means off — the flag can never be
 * accidentally true from an absent variable.
 */
export function digestAlertsJevEnabled(env: AppEnv): boolean {
	const value = env.JEV_ALERTS?.trim().toLowerCase();
	return Boolean(value && JEV_ALERTS_ENABLE_VALUES.has(value));
}

/**
 * Isolate-scoped unpaid circuit. Once Workers AI reports the Jev binding is
 * unpaid, later runs in this isolate skip rather than bill 402s onto every
 * digest. Mirrors the input screen's circuit.
 */
let unpaidBinding = false;

/** Test hook: each unit test starts with a closed circuit. */
export function resetDigestAlertsBindingCircuitForTests(): void {
	unpaidBinding = false;
}

export function digestAlertsBindingCircuitIsOpen(): boolean {
	return unpaidBinding;
}

/** One digest candidate offered to the advisory score. */
export interface DigestAlertItemInput {
	/** Stable source key — the watch_event id the digest item was built from. */
	eventId: string;
	watchlistId: string;
	watchlistName: string;
	eventType: string;
	title: string;
	summary: string;
	/** The heuristic score the cohort ranked on; null when the event lacks one. */
	priorityScore: number | null;
	/** True when the existing cohort selected this item for delivery. */
	inCohort: boolean;
}

export interface DigestAlertsInput {
	digestRunId: string;
	cadence: string;
	periodStart: string;
	periodEnd: string;
	items: readonly DigestAlertItemInput[];
	/** Traceability ref; defaults to the issue. */
	ref?: string;
	timeoutMs?: number;
}

/** Minimal structural view of the Workers AI binding. */
export interface DigestAlertsAi {
	run(model: string, input: { state: unknown; questions: unknown }): Promise<unknown>;
}

/** Parsed, validated answers for one item. */
export interface DigestAlertAnswers {
	worthTellingP: number;
	/** Ordinal significance 0-3 — the issue's worth_alert. */
	worthAlert: number;
	worthAlertConfidence: number | null;
}

/** Raised when the service answers with something we cannot trust. */
export class DigestAlertsAnswerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DigestAlertsAnswerError";
	}
}

const MAX_TITLE_CHARS = 300;
const MAX_SUMMARY_CHARS = 600;
const MAX_WATCHLIST_NAME_CHARS = 120;

export const DIGEST_ALERTS_WORTH_ALERT_LEVELS = [
	"Not significant: routine noise, a change with no offer, price, creative or positioning substance a marketer could act on.",
	"Minor: a real change, but ordinary — worth a line in a weekly brief at most.",
	"Notable: a concrete offer, price, creative or landing-page change a marketer should see this period.",
	"Major: a move that changes the competitive picture — a new campaign direction, a price reset, a flagship launch.",
] as const;

function sanitizeKey(key: string): string {
	return key.trim();
}

/**
 * Deduplicated item keys, first occurrence wins — a repeated event id can only
 * carry one question pair, so a duplicate would double-count it.
 */
export function digestAlertItemKeys(
	items: readonly DigestAlertItemInput[],
): string[] {
	const seen = new Set<string>();
	const keys: string[] = [];
	for (const item of items.slice(0, DIGEST_ALERTS_MAX_ITEMS)) {
		const key = sanitizeKey(item.eventId);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		keys.push(key);
	}
	return keys;
}

export function worthTellingQuestionId(key: string): string {
	return `worth_telling:${key}`;
}

export function significanceQuestionId(key: string): string {
	return `significance:${key}`;
}

/**
 * Build the single batched request: one state carrying the run identity and
 * every candidate item, then two questions per item — `worth_telling` (noul)
 * and `significance` (0-3 score) — keyed by the item's event id so the answer
 * map joins back without a positional contract.
 */
export function buildDigestAlertsRequest(input: DigestAlertsInput): {
	state: unknown;
	questions: Record<string, unknown>;
} {
	const keys = digestAlertItemKeys(input.items);
	// First occurrence wins, matching digestAlertItemKeys — a repeated event id
	// can only carry one question pair, so a duplicate must resolve to the same
	// item the keys kept.
	const byKey = new Map<string, DigestAlertItemInput>();
	for (const item of input.items.slice(0, DIGEST_ALERTS_MAX_ITEMS)) {
		const key = sanitizeKey(item.eventId);
		if (!byKey.has(key)) byKey.set(key, item);
	}

	const state: Record<string, unknown> = {
		site: DIGEST_ALERTS_SITE,
		digest_run_id: input.digestRunId,
		cadence: input.cadence,
		period_start: input.periodStart,
		period_end: input.periodEnd,
		items: keys.map((key) => {
			const item = byKey.get(key)!;
			return {
				key,
				watchlist_name: item.watchlistName.slice(0, MAX_WATCHLIST_NAME_CHARS),
				event_type: item.eventType,
				title: item.title.slice(0, MAX_TITLE_CHARS),
				summary: item.summary.slice(0, MAX_SUMMARY_CHARS),
				priority_score: item.priorityScore,
				in_cohort: item.inCohort,
			};
		}),
	};

	const questions: Record<string, unknown> = {};
	for (const key of keys) {
		const item = byKey.get(key)!;
		questions[worthTellingQuestionId(key)] = {
			type: "noul",
			instructions:
				`You are scoring one candidate item for a competitor-intelligence digest email. ` +
				`The item is state.items entry with key "${key}" — a change detected on the ` +
				`tracked competitor watchlist "${item.watchlistName.slice(0, MAX_WATCHLIST_NAME_CHARS)}". ` +
				"Is this item worth telling the customer about in this period's digest? " +
				"Answer yes only when a marketer tracking this competitor would want to know " +
				"about it this period.",
			criteria: {
				true:
					"The item carries real signal — a new or changed ad, an offer or price move, " +
					"a landing-page or positioning change — that a marketer could act on.",
				false:
					"The item is routine noise, a trivial or duplicated change, or lacks enough " +
					"substance to justify an alert.",
			},
		};
		questions[significanceQuestionId(key)] = {
			type: "score",
			instructions:
				`Score the significance of the state.items entry with key "${key}" for a ` +
				"competitor-intelligence digest. Judge the substance of the change, not the " +
				"item's length or wording.",
			criteria: [...DIGEST_ALERTS_WORTH_ALERT_LEVELS],
		};
	}

	return { state, questions };
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function readNoul(answer: unknown, key: string): number {
	const record = asRecord(answer);
	if (record?.type !== "noul") {
		throw new DigestAlertsAnswerError(
			`${key} answered with type ${JSON.stringify(record?.type)}`,
		);
	}
	const value = record.noul;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 1
	) {
		throw new DigestAlertsAnswerError(
			`${key} returned an invalid noul: ${JSON.stringify(value)}`,
		);
	}
	return value;
}

function readScore(
	answer: unknown,
	key: string,
	maxScore: number,
): { score: number; confidence: number | null } {
	const record = asRecord(answer);
	if (record?.type !== "score") {
		throw new DigestAlertsAnswerError(
			`${key} answered with type ${JSON.stringify(record?.type)}`,
		);
	}
	const score = record.score;
	if (
		typeof score !== "number" ||
		!Number.isFinite(score) ||
		score < 0 ||
		score > maxScore
	) {
		throw new DigestAlertsAnswerError(
			`${key} returned an invalid score: ${JSON.stringify(score)}`,
		);
	}
	const confidence = record.confidence;
	return {
		score,
		confidence:
			typeof confidence === "number" && Number.isFinite(confidence)
				? confidence
				: null,
	};
}

/**
 * Validate the batched answer: every scored item must carry both questions,
 * each in range. A partial answer is an error, not a row with holes.
 */
export function validateDigestAlertsAnswer(
	raw: unknown,
	itemKeys: readonly string[],
): Map<string, DigestAlertAnswers> {
	const root = asRecord(raw);
	const answers = asRecord(root?.answers);
	if (!answers) {
		throw new DigestAlertsAnswerError("the advisory call returned no answers object");
	}
	const result = new Map<string, DigestAlertAnswers>();
	for (const key of itemKeys) {
		const worthTelling = readNoul(
			answers[worthTellingQuestionId(key)],
			worthTellingQuestionId(key),
		);
		const significance = readScore(
			answers[significanceQuestionId(key)],
			significanceQuestionId(key),
			DIGEST_ALERTS_WORTH_ALERT_LEVELS.length - 1,
		);
		result.set(key, {
			worthTellingP: worthTelling,
			worthAlert: significance.score,
			worthAlertConfidence: significance.confidence,
		});
	}
	return result;
}

/** SHA-256 of the exact state sent, so stored rows are traceable to inputs. */
export async function digestAlertsStateSha256(state: unknown): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(stableJson(state)),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function readUsage(raw: unknown): { input_tokens: number; output_tokens: number } {
	const usage = asRecord(asRecord(raw)?.usage);
	return {
		input_tokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
		output_tokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
	};
}

function readModel(raw: unknown, fallback: string): string {
	const reported = asRecord(raw)?.model;
	return typeof reported === "string" && reported !== "" ? reported : fallback;
}

/** The provisional flag the code derives from stored columns — never the model's. */
export function digestAlertWouldSuppress(
	item: Pick<DigestAlertItemInput, "inCohort">,
	answers: Pick<DigestAlertAnswers, "worthTellingP">,
): boolean {
	return (
		item.inCohort &&
		answers.worthTellingP < DIGEST_ALERTS_WOULD_SUPPRESS_BELOW
	);
}

export interface DigestAlertsDecision {
	answers: Map<string, DigestAlertAnswers>;
	stateSha256: string;
	model: string;
	usage: { input_tokens: number; output_tokens: number };
	ms: number;
}

/** Ask the advisory score, validate, and report the decision material. */
export async function decideDigestAlerts(
	ai: DigestAlertsAi,
	input: DigestAlertsInput,
): Promise<DigestAlertsDecision> {
	const itemKeys = digestAlertItemKeys(input.items);
	if (itemKeys.length === 0) {
		throw new DigestAlertsAnswerError("no digest items to score");
	}
	const { state, questions } = buildDigestAlertsRequest(input);
	const startedAt = Date.now();
	const run = ai.run(DIGEST_ALERTS_MODEL, { state, questions });
	const timeoutMs = input.timeoutMs ?? DIGEST_ALERTS_TIMEOUT_MS;
	const raw =
		typeof timeoutMs === "number" && timeoutMs > 0
			? await promiseWithTimeout(run, timeoutMs, "digest alerts scoring timed out.")
			: await run;
	if (isUnpaidWorkersAiJev(raw)) {
		throw new DigestAlertsAnswerError(
			`Workers AI typesafe/jev unpaid: ${JSON.stringify(raw)}`,
		);
	}
	const ms = Date.now() - startedAt;
	const answers = validateDigestAlertsAnswer(raw, itemKeys);
	return {
		answers,
		stateSha256: await digestAlertsStateSha256(state),
		model: readModel(raw, DIGEST_ALERTS_MODEL),
		usage: readUsage(raw),
		ms,
	};
}

export interface ShadowDigestAlertsResult {
	scored: number;
	wouldSuppress: string[];
}

/**
 * Default evidence sink, resolved lazily so the strict-mock precedent holds:
 * a `~/lib/data.server` adapter that omits the export surfaces as a caught
 * advisory failure, never a module-load error.
 */
async function defaultPersistDigestItemJevScores(
	env: AppEnv,
	rows: readonly DigestItemJevScoreInput[],
): Promise<number> {
	const dataModule = await import("~/lib/data.server");
	const upsert = dataModule.upsertDigestItemJevScores;
	if (typeof upsert !== "function") {
		throw new DigestAlertsAnswerError(
			"digest_item_jev_score persistence is unavailable",
		);
	}
	return upsert(env, rows);
}

/**
 * Observe-only entry point for the digest run: scores the candidates, writes
 * the evidence rows, and emits one summary log line naming what the existing
 * cohort would have suppressed. Swallows every failure — the digest is
 * delivered from the unchanged cohort regardless.
 */
export async function shadowScoreDigestItems(
	env: AppEnv,
	input: DigestAlertsInput,
	persist: (
		env: AppEnv,
		rows: readonly DigestItemJevScoreInput[],
	) => Promise<number> = defaultPersistDigestItemJevScores,
): Promise<ShadowDigestAlertsResult | null> {
	const ref = input.ref ?? DIGEST_ALERTS_ISSUE_REF;
	try {
		// Guards live inside the try: strict-mock env adapters can throw on bare
		// property access, and the shadow contract is never-throw.
		if (!digestAlertsJevEnabled(env) || !env.AI || unpaidBinding) {
			return null;
		}
		const items = input.items.slice(0, DIGEST_ALERTS_MAX_ITEMS);
		if (items.length === 0) {
			return null;
		}
		const { answers, stateSha256, model, usage, ms } = await decideDigestAlerts(
			env.AI,
			input,
		);
		const byKey = new Map<string, DigestAlertItemInput>();
		for (const item of items) {
			const key = sanitizeKey(item.eventId);
			if (!byKey.has(key)) byKey.set(key, item);
		}
		const rows = [...answers.entries()].flatMap(([key, answer]) => {
			const item = byKey.get(key);
			if (!item) return [];
			return [
				{
					digestRunId: input.digestRunId,
					eventId: item.eventId,
					watchlistId: item.watchlistId,
					eventType: item.eventType,
					inCohort: item.inCohort,
					priorityScore: item.priorityScore,
					worthTellingP: answer.worthTellingP,
					worthAlert: answer.worthAlert,
					worthAlertConfidence: answer.worthAlertConfidence,
					wouldSuppress: digestAlertWouldSuppress(item, answer),
					stateSha256,
					model,
					inputTokens: usage.input_tokens,
					outputTokens: usage.output_tokens,
					ms,
				},
			];
		});
		const persisted = await persist(env, rows);
		const wouldSuppress = rows
			.filter((row) => row.wouldSuppress)
			.map((row) => row.eventId);
		console.info(
			JSON.stringify({
				event: "jev_digest_scores",
				ts: new Date().toISOString(),
				site: DIGEST_ALERTS_SITE,
				ref,
				digest_run_id: input.digestRunId,
				cadence: input.cadence,
				items_scored: persisted,
				would_suppress: wouldSuppress,
				state_sha256: stateSha256,
				model,
				usage,
				ms,
			}),
		);
		return { scored: persisted, wouldSuppress };
	} catch (error) {
		const unpaid = isUnpaidWorkersAiJev(error);
		if (unpaid) unpaidBinding = true;
		console.info(
			JSON.stringify({
				event: unpaid
					? "digest_alerts_binding_unpaid"
					: "digest_alerts_shadow_failed",
				ts: new Date().toISOString(),
				site: DIGEST_ALERTS_SITE,
				ref,
				digest_run_id: input.digestRunId,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return null;
	}
}
