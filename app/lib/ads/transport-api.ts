import { z } from "zod";

import {
	readCursorPath,
	renderDescriptorTemplate,
	type AdsSourceDescriptor,
} from "./descriptor";

export interface ApiTransportContext {
	
	secrets?: Record<string, string | undefined>;
	
	fetchImpl?: typeof fetch;
}

export interface TransportResult {
	
	payload: unknown;
	
	status: number;
	
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

const REQUEST_TIMEOUT_MS = 20_000;

const MAX_PAGES = 5;

const cursorSchema = z.string().min(1).max(512);

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
			redirect: descriptor.auth.kind === "bearer" ? "manual" : "follow",
		});
		status = res.status;

		const text = await res.text();
		let pagePayload: unknown;
		try {
			pagePayload = JSON.parse(text);
		} catch {
			pagePayload = text;
		}
		pages.push(pagePayload);

		if (descriptor.paginationCursorPath === undefined || !res.ok) break;
		const parsed = cursorSchema.safeParse(
			readCursorPath(pagePayload, descriptor.paginationCursorPath),
		);
		if (!parsed.success || parsed.data === cursor) break;
		cursor = parsed.data;
	}

	return {
		payload:
			descriptor.paginationCursorPath === undefined ? pages[0] : pages,
		status,
		ms: Date.now() - started,
	};
}
