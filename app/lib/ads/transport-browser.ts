import { connect, launch, sessions } from "@cloudflare/puppeteer";

import {
	renderDescriptorTemplate,
	type AdsSourceDescriptor,
} from "./descriptor";
import type { TransportResult } from "./transport-api";

export interface BrowserBindingLike {
	fetch: typeof fetch;
	quickAction(
		action: "content",
		options: { url: string },
	): Promise<Response>;
}

export interface BrowserTransportResult extends TransportResult {
	
	browserMsUsed?: number;
}

const NAV_TIMEOUT_MS = 30_000;
const SELECTOR_TIMEOUT_MS = 20_000;

export async function transportBrowser(
	descriptor: AdsSourceDescriptor,
	target: string,
	env: { BROWSER: BrowserBindingLike },
): Promise<BrowserTransportResult> {
	const u = new URL(
		renderDescriptorTemplate(descriptor.endpoint, { target }),
	);
	
	for (const [k, v] of Object.entries(descriptor.params)) {
		u.searchParams.set(
			k,
			renderDescriptorTemplate(v, { target }, false),
		);
	}
	const url = u.toString();
	const started = Date.now();

	if (descriptor.waitForSelector === undefined) {
		const res = await env.BROWSER.quickAction("content", { url });
		const msUsedHeader = res.headers.get("x-browser-ms-used");
		const msUsed =
			msUsedHeader === null ? NaN : Number(msUsedHeader);
		const body = await res.text();
		
		
		
		let payload: unknown = body;
		let status = res.status;
		try {
			const parsed = JSON.parse(body) as {
				result?: string;
				meta?: { status?: number };
			};
			if (typeof parsed.result === "string") {
				payload = parsed.result;
				if (typeof parsed.meta?.status === "number") {
					status = parsed.meta.status;
				}
			}
		} catch {
			payload = body;
			status = res.status;
		}
		return {
			payload,
			status,
			ms: Date.now() - started,
			browserMsUsed: Number.isFinite(msUsed) ? msUsed : undefined,
		};
	}

	const active = await sessions(env.BROWSER);
	const idle = active.find((s) => s.connectionId === undefined);
	const browser = idle
		? await connect(env.BROWSER, idle.sessionId)
		: await launch(env.BROWSER);
	try {
		const page = await browser.newPage();
		try {
			const response = await page.goto(url, {
				waitUntil: "domcontentloaded",
				timeout: NAV_TIMEOUT_MS,
			});
			const status = response?.status() ?? 0;
			await page
				.waitForSelector(descriptor.waitForSelector, { timeout: SELECTOR_TIMEOUT_MS })
				.catch(() => undefined);
			const html = await page.content();
			return { payload: html, status, ms: Date.now() - started };
		} finally {
			
			
			await page.close().catch(() => undefined);
		}
	} finally {
		await browser.disconnect();
	}
}
