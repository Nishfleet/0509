import {
	readCursorPath,
	renderDescriptorTemplate,
	type AdsSourceDescriptor,
} from "./descriptor";

/**
 * The api transport — packet P1 of docs/engines/ads.md.
 *
 * One `fetch` per page with `AbortSignal.timeout`, optional bearer auth, and
 * bounded cursor pagination. It holds no platform knowledge: everything it
 * needs arrives on the descriptor. A non-2xx status is returned, not thrown —
 * the sweep marks the source degraded on it and never retries harder (the
 * rate limit lives on the `source` row and is honoured by the Workflow).
 * Thrown errors are reserved for transport-level failures a queue retry can
 * legitimately answer: timeouts, DNS, connection resets.
 */

export interface ApiTransportContext {
	/**
	 * Worker env values by name, consulted only when `auth.kind` is
	 * `bearer` — the descriptor names the variable, never holds the token.
	 */
	secrets?: Record<string, string | undefined>;
	/** Test seam; defaults to the global fetch. */
	fetchImpl?: typeof fetch;
}

export interface TransportResult {
	/**
	 * The decoded page payload. With `paginationCursorPath` set this is an
	 * array of page payloads in fetch order; otherwise the single page's body
	 * (parsed JSON when the body parses, else raw text).
	 */
	payload: unknown;
	/** The last HTTP status the platform returned. */
	status: number;
	/** Wall time for the whole call, all pages included. */
	ms: number;
}

export class AdsTransportAuthError extends Error {
	constructor(secretEnv: string) {
		super(
			`descriptor auth requires env value "${secretEnv}", which is not set — configure the secret, not the row`,
		);
		this.name = "AdsTransportAuthError";
	}
}

/** Per-request ceiling; well under a queue consumer's patience. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Pagination is a cost knob: five pages per pull, then the sweep moves on. */
const MAX_PAGES = 5;

export async function transportApi(
	descriptor: AdsSourceDescriptor,
	target: string,
	ctx: ApiTransportContext = {},
): Promise<TransportResult> {
	const fetchImpl = ctx.fetchImpl ?? fetch;

	const headers: Record<string, string> = {};
	if (descriptor.auth.kind === "bearer") {
		const token = ctx.secrets?.[descriptor.auth.secretEnv];
		if (!token) throw new AdsTransportAuthError(descriptor.auth.secretEnv);
		headers.authorization = `Bearer ${token}`;
	}

	const started = Date.now();
	const pages: unknown[] = [];
	let cursor = "";
	let status = 0;

	for (let page = 0; page < MAX_PAGES; page++) {
		const rendered = renderDescriptorTemplate(descriptor.endpoint, {
			target,
			cursor,
		});
		const params = Object.fromEntries(
			Object.entries(descriptor.params).map(([k, v]) => [
				k,
				// Raw substitution: URLSearchParams and JSON.stringify encode.
				renderDescriptorTemplate(v, { target, cursor }, false),
			]),
		);

		let url = rendered;
		let body: string | undefined;
		if (descriptor.method === "GET") {
			const u = new URL(rendered);
			for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
			url = u.toString();
		} else {
			headers["content-type"] = "application/json";
			body = JSON.stringify(params);
		}

		const res = await fetchImpl(url, {
			method: descriptor.method,
			headers,
			body,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		status = res.status;

		const text = await res.text();
		let pagePayload: unknown = text;
		try {
			pagePayload = JSON.parse(text);
		} catch {
			// Not JSON — the payload is the raw body and a field map decides.
		}
		pages.push(pagePayload);

		if (descriptor.paginationCursorPath === undefined || !res.ok) break;
		const next = readCursorPath(pagePayload, descriptor.paginationCursorPath);
		if (next === undefined || next === cursor) break;
		cursor = next;
	}

	return {
		payload:
			descriptor.paginationCursorPath === undefined ? pages[0] : pages,
		status,
		ms: Date.now() - started,
	};
}
