import { connect, launch, sessions } from "@cloudflare/puppeteer";

import {
	renderDescriptorTemplate,
	type AdsSourceDescriptor,
} from "./descriptor";
import type { TransportResult } from "./transport-api";

/**
 * The browser transport — packet P1 of docs/engines/ads.md.
 *
 * Two legs, chosen by the descriptor's own shape:
 *
 * - No `waitForSelector` → the binding's `quickAction("content")`, which is a
 *   single managed call that needs no session lifecycle.
 * - `waitForSelector` set → a real session, reused where one is idle:
 *   `sessions()` → `connect()` → `disconnect()`, never `close()`. Closing a
 *   browser re-pays the cold-launch seconds and burns the 3-new-browsers-per-
 *   second limit, which bites before concurrency does on a bursty sweep
 *   (docs/REBUILD-STACK.md §4.3).
 *
 * This module never opens a browser on its own initiative — it is called by
 * the `page-sweep` queue consumer, the only place a browser may be opened,
 * and the descriptor carries no platform names.
 */

/** What the transport needs from the `browser` binding — nothing more. */
export interface BrowserBindingLike {
	fetch: typeof fetch;
	quickAction(
		action: "content",
		options: { url: string },
	): Promise<Response>;
}

export interface BrowserTransportResult extends TransportResult {
	/**
	 * `X-Browser-Ms-Used`, when the leg reports it. The Quick Action leg
	 * returns the header; the session leg has no SDK surface for it, so the
	 * sweep records wall `ms` for those.
	 */
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
	// Raw substitution in params — URLSearchParams encodes on serialise.
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
		// The action's own status is the transport's; on success the JSON
		// envelope's meta.status is the status the *page* returned, which is
		// what the degrade rule ("non-2xx or challenge body") judges.
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
			// Non-JSON envelope — keep the raw body as the payload.
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
			try {
				await page.waitForSelector(descriptor.waitForSelector, {
					timeout: SELECTOR_TIMEOUT_MS,
				});
			} catch {
				// A selector that never renders is the challenge-body case: the
				// sweep degrades on what came back, so hand it the page anyway
				// rather than burn queue retries on a page that will not change.
			}
			const html = await page.content();
			return { payload: html, status, ms: Date.now() - started };
		} finally {
			// Closing the TAB is fine and keeps a reused session clean; the
			// ban is on closing the browser. A tab already gone is not an error.
			await page.close().catch(() => undefined);
		}
	} finally {
		await browser.disconnect();
	}
}
