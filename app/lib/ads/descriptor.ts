import { z } from "zod";

const RELIABILITY = ["official_api", "rss", "scraped_page", "best_effort"] as const;

const TARGET_TOKEN = "{target}";
const CURSOR_TOKEN = "{cursor}";

const authSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("none") }),
	
	
	z.object({ kind: z.literal("bearer"), secretEnv: z.string().min(1) }),
]);

export const adsSourceDescriptorSchema = z
	.object({
		transport: z.enum(["api", "browser"]),
		
		endpoint: z.string().min(1),
		method: z.enum(["GET", "POST"]).default("GET"),
		
		
		params: z.record(z.string(), z.string()).default({}),
		auth: authSchema.default({ kind: "none" }),
		
		
		
		waitForSelector: z.string().min(1).optional(),
		
		
		paginationCursorPath: z.string().min(1).optional(),
		
		
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
		} catch (error) {
			console.error(JSON.stringify({ event: "ads.endpoint_render_failed", error: String(error) }));
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

export function parseAdsDescriptor(raw: unknown): AdsSourceDescriptor {
	let data: unknown = raw;
	if (typeof raw === "string") {
		try {
			data = JSON.parse(raw);
		} catch (error) {
			console.error(JSON.stringify({ event: "ads.config_json_parse_failed", error: String(error) }));
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
