import { z } from "zod";

/**
 * The ads engine's source descriptor — packet P1 of docs/engines/ads.md.
 *
 * A descriptor is DATA with a fixed shape, carried on a `source` row's
 * `config_json`. It names an endpoint template, a method, static params, an
 * auth kind, an optional wait-for selector (browser transport), an optional
 * pagination cursor path (api transport), a rate limit and a reliability.
 * It carries no conditionals and no expressions: a platform that needs
 * anything outside this set gets a real adapter module, not a bigger DSL.
 *
 * Two template tokens are recognised in `endpoint` and in `params` values:
 * `{target}` — the watch's target_key (an advertiser name, domain or id), and
 * `{cursor}` — the pagination cursor extracted at `paginationCursorPath`.
 * Both are substituted before the URL is built; `{target}` is required so a
 * descriptor can never pull "everybody's" ads.
 */

/** Mirrors the `source.reliability` CHECK constraint in migrations/0001_rebuild.sql. */
const RELIABILITY = ["official_api", "rss", "scraped_page", "best_effort"] as const;

const TARGET_TOKEN = "{target}";
const CURSOR_TOKEN = "{cursor}";

const authSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("none") }),
	// `secretEnv` NAMES a Worker secret/var that holds the token (for example a
	// research-API key). The row never carries a credential itself.
	z.object({ kind: z.literal("bearer"), secretEnv: z.string().min(1) }),
]);

export const adsSourceDescriptorSchema = z
	.object({
		transport: z.enum(["api", "browser"]),
		// URL template, e.g. "https://example.com/ads?advertiser={target}".
		endpoint: z.string().min(1),
		method: z.enum(["GET", "POST"]).default("GET"),
		// Static parameters whose values may carry the same two tokens. GET
		// sends them as query parameters; POST sends them as a JSON body.
		params: z.record(z.string(), z.string()).default({}),
		auth: authSchema.default({ kind: "none" }),
		// Browser transport only: the CSS selector the page must render before
		// content is captured. Its presence is what routes a browser descriptor
		// onto a full session instead of a Quick Action.
		waitForSelector: z.string().min(1).optional(),
		// Api transport only: dot path into the JSON response holding the
		// next-page cursor, e.g. "data.next_cursor".
		paginationCursorPath: z.string().min(1).optional(),
		// Requests per minute the sweep honours for this source. Stored, not
		// enforced here — pacing is the Workflow's job, never a sleep loop.
		rateLimitPerMinute: z.number().int().positive(),
		reliability: z.enum(RELIABILITY),
	})
	.strict()
	.check((ctx) => {
		const d = ctx.value;
		const templated = [d.endpoint, ...Object.values(d.params)];
		const hasTarget = templated.some((t) => t.includes(TARGET_TOKEN));
		const hasCursor = templated.some((t) => t.includes(CURSOR_TOKEN));

		if (!hasTarget) {
			ctx.issues.push({
				code: "custom",
				message: `descriptor must address a target: ${TARGET_TOKEN} is required in endpoint or a params value`,
				path: ["endpoint"],
				input: d.endpoint,
			});
		}
		if (d.waitForSelector !== undefined && d.transport !== "browser") {
			ctx.issues.push({
				code: "custom",
				message: "waitForSelector is only meaningful on the browser transport",
				path: ["waitForSelector"],
				input: d.waitForSelector,
			});
		}
		if (d.paginationCursorPath !== undefined && d.transport !== "api") {
			ctx.issues.push({
				code: "custom",
				message: "paginationCursorPath is only meaningful on the api transport",
				path: ["paginationCursorPath"],
				input: d.paginationCursorPath,
			});
		}
		if (d.paginationCursorPath !== undefined && !hasCursor) {
			ctx.issues.push({
				code: "custom",
				message: `paginationCursorPath is set but nothing asks for a page: ${CURSOR_TOKEN} is required in endpoint or a params value`,
				path: ["paginationCursorPath"],
				input: d.paginationCursorPath,
			});
		}
		if (d.paginationCursorPath === undefined && hasCursor) {
			ctx.issues.push({
				code: "custom",
				message: `${CURSOR_TOKEN} is used but paginationCursorPath is not set`,
				path: ["endpoint"],
				input: d.endpoint,
			});
		}
		// The endpoint is a template; validate the URL it renders into, not the
		// template text. Outbound ad-transparency surfaces are all https.
		try {
			const rendered = renderDescriptorTemplate(d.endpoint, {
				target: "probe",
				cursor: "",
			});
			if (new URL(rendered).protocol !== "https:") {
				ctx.issues.push({
					code: "custom",
					message: "endpoint must render to an https URL",
					path: ["endpoint"],
					input: d.endpoint,
				});
			}
		} catch {
			ctx.issues.push({
				code: "custom",
				message: "endpoint does not render to a valid URL",
				path: ["endpoint"],
				input: d.endpoint,
			});
		}
	});

export type AdsSourceDescriptor = z.output<typeof adsSourceDescriptorSchema>;

export class AdsDescriptorError extends Error {
	readonly issues: string[];
	constructor(issues: string[]) {
		super(`invalid ads source descriptor: ${issues.join("; ")}`);
		this.name = "AdsDescriptorError";
		this.issues = issues;
	}
}

/**
 * Parse and validate a descriptor from a `source` row's `config_json` (or an
 * already-decoded object). Throws AdsDescriptorError with every issue found —
 * a bad row is rejected where it is loaded, never discovered mid-sweep.
 */
export function parseAdsDescriptor(raw: unknown): AdsSourceDescriptor {
	let data: unknown = raw;
	if (typeof raw === "string") {
		try {
			data = JSON.parse(raw);
		} catch {
			throw new AdsDescriptorError(["config_json is not valid JSON"]);
		}
	}
	const result = adsSourceDescriptorSchema.safeParse(data);
	if (!result.success) {
		throw new AdsDescriptorError(
			result.error.issues.map(
				(i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
			),
		);
	}
	return result.data;
}

/**
 * Substitute the two template tokens. `target` is always present (a watch's
 * target_key); `cursor` defaults to the empty string, which is what the first
 * page of a paginated endpoint asks for.
 *
 * `encode` applies `encodeURIComponent` to the substituted values. The
 * endpoint template needs it — it renders into a raw URL string. Params
 * values must NOT be encoded here: GET params go through `URLSearchParams`
 * and POST params through `JSON.stringify`, both of which encode themselves.
 */
export function renderDescriptorTemplate(
	template: string,
	vars: { target: string; cursor?: string },
	encode = true,
): string {
	const target = encode ? encodeURIComponent(vars.target) : vars.target;
	const cursor = encode
		? encodeURIComponent(vars.cursor ?? "")
		: (vars.cursor ?? "");
	return template.split(TARGET_TOKEN).join(target).split(CURSOR_TOKEN).join(cursor);
}

/**
 * Read a dot path (`"data.next_cursor"`) out of a decoded JSON payload.
 * Numeric segments index into arrays. Returns undefined on any miss; a number
 * leaf is coerced to string so cursor types do not leak into callers.
 */
export function readCursorPath(
	payload: unknown,
	path: string,
): string | undefined {
	let node: unknown = payload;
	for (const segment of path.split(".")) {
		if (node === null || typeof node !== "object") return undefined;
		node = Array.isArray(node)
			? node[Number(segment)]
			: (node as Record<string, unknown>)[segment];
	}
	if (typeof node === "string" && node.length > 0) return node;
	if (typeof node === "number" && Number.isFinite(node)) return String(node);
	return undefined;
}
