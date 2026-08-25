import { decodeHtmlEntities } from "~/lib/decode-html.server";
import { sha256Base64Url } from "~/lib/presence-hash";

/**
 * Pure, deterministic core for competitor website content: URL canonicalization,
 * page-kind classification, HTML normalization, batch selection, and change
 * evaluation. No network, no AI, no storage — every exported function is a
 * deterministic function of its inputs.
 */

// ==== Vocabulary ====

export type CompetitorSitePageKind =
	| "home"
	| "pricing"
	| "changelog"
	| "landing"
	| "product"
	| "blog"
	| "docs"
	| "about"
	| "contact"
	| "other";

export type CompetitorSiteChangeKind = "page-added" | "page-removed" | "field-changed";

export type CompetitorSiteChangeField =
	| "page"
	| "title"
	| "meta"
	| "visibleText"
	| "offerPrice"
	| "cta"
	| "form";

export const COMPETITOR_PAGE_NORMALIZER_VERSION = "competitor-page-normalizer-v1";
export const COMPETITOR_SITE_DEFAULT_MAX_PAGES_PER_RUN = 50;
export const COMPETITOR_SITE_MAX_PAGES_PER_RUN = 50;
export const COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT = 500;
export const COMPETITOR_PAGE_VISIBLE_TEXT_EXCERPT_LIMIT = 2_000;
export const COMPETITOR_PAGE_OFFER_TEXT_LIMIT = 200;
export const COMPETITOR_PAGE_CTA_TEXT_LIMIT = 120;

export interface CompetitorSiteCandidate {
	/** Canonical URL (see canonicalizeCompetitorSiteUrl). */
	canonicalUrl: string;
	/** Where the candidate was discovered, e.g. "sitemap", "crawl", "seed". */
	discoverySource: string;
	kind: CompetitorSitePageKind;
	/** Stable discovery order; used for fair rotation across runs. */
	discoveryOrder: number;
}

export interface CompetitorSitePageHints {
	/** Explicit kind override; ignored unless it is a valid page kind. */
	kind?: CompetitorSitePageKind;
	/** Path override used when the URL itself cannot be parsed. */
	path?: string;
	/** Title hint used for keyword-based classification. */
	title?: string;
}

export interface CompetitorSiteRunPolicy {
	/**
	 * At most this many candidates per batch. Default 50; clamped to [1, 50].
	 */
	maxPagesPerRun?: number;
}

export interface CompetitorSiteRunState {
	/** Opaque cursor returned by the previous batch; null starts a fresh cycle. */
	nextCursor: string | null;
}

export interface CompetitorSiteRunBatch {
	candidates: CompetitorSiteCandidate[];
	nextCursor: string | null;
}

export interface CompetitorPageContentInput {
	/** Already-canonical URL; stored verbatim in the normalized result. */
	canonicalUrl: string;
	rawHtml: string;
	/** Optional override; otherwise extracted from rawHtml. */
	title?: string | null;
	/** Optional override; otherwise extracted from rawHtml. */
	metaDescription?: string | null;
}

export interface NormalizedCompetitorPageContent {
	normalizerVersion: string;
	canonicalUrl: string;
	/** Bounded to 500 chars; explicit null when empty/missing. */
	title: string | null;
	/** Bounded to 500 chars; explicit null when empty/missing. */
	metaDescription: string | null;
	/** Bounded to 2,000 chars; explicit null when empty/missing. */
	visibleTextExcerpt: string | null;
	/** sha256Base64Url of the full normalized visible text; null when empty. */
	visibleTextHash: string | null;
	/** Bounded to 200 chars; explicit null when no offer/price signal found. */
	offerOrPriceText: string | null;
	/** Bounded to 120 chars; explicit null when no CTA signal found. */
	ctaText: string | null;
	formPresent: boolean;
	/** sha256Base64Url over a deterministic versioned serialization. */
	contentHash: string;
}

export interface InventoryCompletenessEvidence {
	priorInventoryComplete: boolean;
	currentInventoryComplete: boolean;
}

export interface WebsitePageChange {
	kind: CompetitorSiteChangeKind;
	field: CompetitorSiteChangeField;
	canonicalUrl: string;
	/** Bounded to 500 chars; explicit null when the side is missing. */
	before: string | null;
	/** Bounded to 500 chars; explicit null when the side is missing. */
	after: string | null;
	material: boolean;
	/** Stable reason when material; explicit null for storable-but-not-alertable facts. */
	materialReason: string | null;
	/** Stable: `${kind}|${field}|${canonicalUrl}`. */
	dedupeKey: string;
	priorCaptureAt: string | null;
	currentCaptureAt: string | null;
	/** Evidence attached to page additions/removals; null for field facts. */
	inventoryCompleteness: InventoryCompletenessEvidence | null;
}

/** Maps canonical URL -> normalized content. */
export type CompetitorPageInventory = ReadonlyMap<string, NormalizedCompetitorPageContent>;

export interface WebsiteChangeContext {
	/**
	 * True when the current inventory is a complete capture. A page removal is
	 * only recorded when this is true; otherwise the removal fact is omitted.
	 */
	currentInventoryComplete: boolean;
	/** Completeness of the prior capture; carried as evidence on add/remove facts. */
	priorInventoryComplete: boolean;
	currentCaptureAt?: string | null;
	priorCaptureAt?: string | null;
}

// ==== URL canonicalization ====

/** Known tracking parameters that are always stripped (case-insensitive). */
const TRACKING_QUERY_PARAMS = new Set([
	"gclid",
	"fbclid",
	"gbraid",
	"wbraid",
	"msclkid",
	"dclid",
	"twclid",
	"gclsrc",
	"yclid",
	"srsltid",
	"igshid",
	"li_fat_id",
	"mc_cid",
	"mc_eid",
]);

function defaultPort(protocol: string): string {
	return protocol === "https:" ? "443" : "80";
}

function portOf(url: URL): number {
	return url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
}

function parseRootOrigin(raw: string): { protocol: string; hostname: string; port: number } | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username !== "" || url.password !== "") return null;
	return { protocol: url.protocol, hostname: url.hostname.toLowerCase(), port: portOf(url) };
}

/**
 * Canonicalize a competitor site URL.
 *
 * Accepts only HTTP(S). Rejects credentials and (when rootOrigin is supplied)
 * cross-origin URLs. Strips fragments and known tracking parameters, sorts the
 * remaining query parameters, normalizes default ports and a single trailing
 * slash. Distinct paths are never collapsed (e.g. "/a//b" and "/a/b" differ).
 * Returns null for invalid, unsupported, or disallowed inputs.
 */
export function canonicalizeCompetitorSiteUrl(
	rawUrl: string,
	rootOrigin?: string,
): string | null {
	if (typeof rawUrl !== "string" || rawUrl.trim() === "") return null;
	let url: URL;
	try {
		url = new URL(rawUrl.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username !== "" || url.password !== "") return null;
	if (rootOrigin !== undefined && rootOrigin !== null) {
		const root = parseRootOrigin(rootOrigin);
		if (root === null) return null;
		if (url.protocol !== root.protocol || url.hostname.toLowerCase() !== root.hostname) {
			return null;
		}
		if (portOf(url) !== root.port) return null;
	}

	const pathname = url.pathname === "" ? "/" : url.pathname;
	const normalizedPath =
		pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

	const kept: Array<[string, string]> = [];
	for (const [key, value] of url.searchParams) {
		const lowerKey = key.toLowerCase();
		if (lowerKey.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(lowerKey)) continue;
		kept.push([key, value]);
	}
	kept.sort((a, b) => {
		if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
		if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
		return 0;
	});
	const query =
		kept.length > 0
			? `?${kept
					.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
					.join("&")}`
			: "";

	const host = url.hostname.toLowerCase();
	const portPart =
		url.port === "" || url.port === defaultPort(url.protocol) ? "" : `:${url.port}`;
	return `${url.protocol}//${host}${portPart}${normalizedPath}${query}`;
}

// ==== Page-kind classification ====

const PAGE_KINDS: readonly CompetitorSitePageKind[] = [
	"home",
	"pricing",
	"changelog",
	"landing",
	"product",
	"blog",
	"docs",
	"about",
	"contact",
	"other",
];

/**
 * First-segment-wins path mapping. "home"/"index.html" are deliberately absent:
 * a path maps to home only when it is the entire path (root).
 */
const SEGMENT_KIND_MAP: Record<string, CompetitorSitePageKind> = {
	pricing: "pricing",
	price: "pricing",
	plans: "pricing",
	plan: "pricing",
	billing: "pricing",
	rates: "pricing",
	changelog: "changelog",
	changelogs: "changelog",
	"release-notes": "changelog",
	releases: "changelog",
	product: "product",
	products: "product",
	features: "product",
	feature: "product",
	solutions: "product",
	solution: "product",
	platform: "product",
	integrations: "product",
	"how-it-works": "product",
	blog: "blog",
	news: "blog",
	articles: "blog",
	article: "blog",
	insights: "blog",
	journal: "blog",
	press: "blog",
	updates: "blog",
	docs: "docs",
	documentation: "docs",
	help: "docs",
	support: "docs",
	guides: "docs",
	guide: "docs",
	manual: "docs",
	reference: "docs",
	api: "docs",
	faq: "docs",
	about: "about",
	"about-us": "about",
	company: "about",
	team: "about",
	careers: "about",
	mission: "about",
	contact: "contact",
	"contact-us": "contact",
	contactus: "contact",
};

/** Title keyword rules; the first matching rule wins. */
const TITLE_PATTERN_RULES: ReadonlyArray<[CompetitorSitePageKind, RegExp]> = [
	["changelog", /changelog|release\s*notes|what'?s\s*new/i],
	["pricing", /\b(pricing|plans?|rate\s*card|prices?)\b/i],
	["docs", /\b(docs?|documentation|help\s*center|knowledge\s*base)\b/i],
	["blog", /\b(blog|articles?|news|insights)\b/i],
	["product", /\b(products?|features?|solutions?|platform)\b/i],
	["about", /\b(about\s*us|about|our\s*story|meet\s*the\s*team)\b/i],
	["contact", /\b(contact|get\s*in\s*touch|reach\s*us)\b/i],
	["home", /\b(home|welcome)\b/i],
];

function pathFromUrlOrHint(url: string, hintPath?: string): string | null {
	const hint = hintPath?.trim() ?? "";
	if (hint !== "") {
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(hint)) {
			try {
				return new URL(hint).pathname;
			} catch {
				// fall through to treating the hint as a raw path
			}
		}
		return hint.startsWith("/") ? hint : `/${hint}`;
	}
	const canonical = canonicalizeCompetitorSiteUrl(url);
	if (canonical === null) return null;
	try {
		return new URL(canonical).pathname;
	} catch {
		return null;
	}
}

/**
 * Deterministically classify a page URL into a page kind.
 *
 * Priority: explicit valid kind hint, then path segments (first mapped segment
 * wins; home only when the path is the root), then title keywords, then "other".
 * An unparseable URL with no usable hints classifies as "other".
 */
export function classifyCompetitorSitePage(
	url: string,
	hints?: CompetitorSitePageHints,
): CompetitorSitePageKind {
	if (hints?.kind !== undefined) {
		if ((PAGE_KINDS as readonly string[]).includes(hints.kind)) return hints.kind;
	}
	const path = pathFromUrlOrHint(url, hints?.path);
	if (path === null) return "other";
	const segments = path
		.split("/")
		.filter((segment) => segment.length > 0)
		.map((segment) => segment.toLowerCase());
	if (segments.length === 0) return "home";
	if (segments.length === 1 && (segments[0] === "home" || segments[0] === "index.html")) {
		return "home";
	}
	for (const segment of segments) {
		const kind = SEGMENT_KIND_MAP[segment];
		if (kind !== undefined) return kind;
	}
	const title = hints?.title?.trim();
	if (title) {
		for (const [kind, pattern] of TITLE_PATTERN_RULES) {
			if (pattern.test(title)) return kind;
		}
	}
	return "other";
}

// ==== HTML normalization ====

/** Markup whose entire content is noise and must be dropped before text extraction. */
const UNWANTED_MARKUP_PATTERNS: RegExp[] = [
	/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
	/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
	/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi,
	/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi,
	/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi,
	/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi,
];

function stripUnwantedMarkup(html: string): string {
	let cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
	for (const pattern of UNWANTED_MARKUP_PATTERNS) {
		cleaned = cleaned.replace(pattern, "");
	}
	return cleaned;
}

/**
 * Standalone dynamic timestamps/dates that churn on every visit. Applied in
 * order: named dates, numeric dates, AM/PM times, then bare times.
 */
const DYNAMIC_TIMESTAMP_PATTERNS: RegExp[] = [
	/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi,
	/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/gi,
	/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
	/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,
	/\b(?:0?[1-9]|1[0-2]):[0-5]\d(?::[0-5]\d)?\s*(?:am|pm)\b/gi,
	/\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/g,
];

const BLOCK_TAG_ENDINGS = [
	"p",
	"div",
	"li",
	"ul",
	"ol",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"section",
	"article",
	"header",
	"footer",
	"nav",
	"main",
	"aside",
	"table",
	"tr",
	"td",
	"th",
	"form",
	"blockquote",
	"pre",
	"hr",
	"figcaption",
	"address",
];

function extractVisibleText(html: string): string {
	let text = html;
	const tags = BLOCK_TAG_ENDINGS.join("|");
	// Block boundaries become newlines so inline text never merges across blocks.
	text = text.replace(new RegExp(`</(?:${tags})>`, "gi"), "\n");
	text = text.replace(new RegExp(`<(?:${tags})\\s[^>]*?>|<(?:${tags})>`, "gi"), "\n");
	text = text.replace(/<(?:br|hr)\s*\/?>/gi, "\n");
	text = text.replace(/<[^>]+>/g, "");
	text = decodeHtmlEntities(text);
	text = text.replace(/\u00a0/g, " ");
	text = text.replace(/[\t\r\n\f ]+/g, " ").trim();
	for (const pattern of DYNAMIC_TIMESTAMP_PATTERNS) {
		text = text.replace(pattern, "");
	}
	text = text.replace(/[\t\r\n\f ]+/g, " ").trim();
	return text;
}

function normalizeBoundedText(value: string, limit: number): string | null {
	const collapsed = value.replace(/[\t\r\n\f ]+/g, " ").trim();
	if (collapsed === "") return null;
	return collapsed.length > limit ? collapsed.slice(0, limit) : collapsed;
}

function extractTitle(html: string): string | null {
	const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
	if (match === null) return null;
	return normalizeBoundedText(decodeHtmlEntities(match[1]), COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT);
}

function extractMetaDescription(html: string): string | null {
	const patterns = [
		/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
		/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i,
	];
	for (const pattern of patterns) {
		const match = pattern.exec(html);
		if (match === null) continue;
		return normalizeBoundedText(
			decodeHtmlEntities(match[1]),
			COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT,
		);
	}
	return null;
}

function detectForm(cleanedHtml: string): boolean {
	if (/<form\b/i.test(cleanedHtml)) return true;
	if (/<(?:input|select|textarea)\b/i.test(cleanedHtml)) return true;
	return false;
}

const PRICE_PATTERNS: RegExp[] = [
	/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s*\/\s*(?:mo|month|monthly|yr|year|yearly|user|seat|per\s+user|per\s+month))?/i,
	/\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*(?:usd|eur|gbp|euros?|dollars?|pounds?)\b/i,
	/\b(?:starting\s+at|from)\s+\$\s?\d[\d,.]*/i,
	/\bfree\s+trial\b/i,
];

/** Earliest match across patterns wins; ties break by pattern order. */
function extractOfferOrPriceText(visibleText: string): string | null {
	let best: { index: number; text: string } | null = null;
	for (const pattern of PRICE_PATTERNS) {
		const match = pattern.exec(visibleText);
		if (match === null) continue;
		if (best === null || match.index < best.index) {
			best = { index: match.index, text: match[0] };
		}
	}
	if (best === null) return null;
	return normalizeBoundedText(best.text, COMPETITOR_PAGE_OFFER_TEXT_LIMIT);
}

const CTA_PHRASES: readonly string[] = [
	"start your free trial",
	"start free trial",
	"book a demo",
	"schedule a demo",
	"get started",
	"sign up free",
	"try it free",
	"try free",
	"contact sales",
	"request a quote",
	"get a quote",
	"talk to sales",
	"watch a demo",
	"buy now",
	"download now",
	"create your account",
	"create account",
	"register now",
	"join now",
	"get the app",
	"see pricing",
	"learn more",
];

/** Earliest phrase occurrence wins; ties break by longest phrase. */
function extractCtaText(visibleText: string): string | null {
	let best: { index: number; text: string } | null = null;
	const lower = visibleText.toLowerCase();
	for (const phrase of CTA_PHRASES) {
		const index = lower.indexOf(phrase);
		if (index === -1) continue;
		if (
			best === null ||
			index < best.index ||
			(index === best.index && phrase.length > best.text.length)
		) {
			best = { index, text: visibleText.slice(index, index + phrase.length) };
		}
	}
	if (best === null) return null;
	return normalizeBoundedText(best.text, COMPETITOR_PAGE_CTA_TEXT_LIMIT);
}

function serializedContentPayload(parts: {
	normalizerVersion: string;
	canonicalUrl: string;
	title: string | null;
	metaDescription: string | null;
	visibleTextHash: string | null;
	offerOrPriceText: string | null;
	ctaText: string | null;
	formPresent: boolean;
}): string {
	// Deterministic versioned serialization: fixed-position tuple, explicit
	// nulls, no object key order to depend on.
	return JSON.stringify([
		"competitor-page-content-v1",
		parts.normalizerVersion,
		parts.canonicalUrl,
		parts.title ?? null,
		parts.metaDescription ?? null,
		parts.visibleTextHash ?? null,
		parts.offerOrPriceText ?? null,
		parts.ctaText ?? null,
		parts.formPresent,
	]);
}

/**
 * Normalize raw competitor page HTML into bounded, hashable content.
 *
 * Script/style/noscript/svg/template/iframe markup, comments, markup, analytics
 * noise, whitespace churn, and standalone dynamic timestamps/dates are removed;
 * common HTML entities are decoded; text is bounded. No raw HTML is retained.
 */
export async function normalizeCompetitorPageContent(
	input: CompetitorPageContentInput,
): Promise<NormalizedCompetitorPageContent> {
	const cleaned = stripUnwantedMarkup(input.rawHtml);
	const title =
		input.title !== undefined && input.title !== null
			? normalizeBoundedText(input.title, COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT)
			: extractTitle(cleaned);
	const metaDescription =
		input.metaDescription !== undefined && input.metaDescription !== null
			? normalizeBoundedText(input.metaDescription, COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT)
			: extractMetaDescription(cleaned);

	const headless = cleaned.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "");
	const visibleText = extractVisibleText(headless);
	const visibleTextExcerpt =
		visibleText === ""
			? null
			: visibleText.slice(0, COMPETITOR_PAGE_VISIBLE_TEXT_EXCERPT_LIMIT);
	const visibleTextHash = visibleText === "" ? null : await sha256Base64Url(visibleText);
	const offerOrPriceText = extractOfferOrPriceText(visibleText);
	const ctaText = extractCtaText(visibleText);
	const formPresent = detectForm(cleaned);

	const parts = {
		normalizerVersion: COMPETITOR_PAGE_NORMALIZER_VERSION,
		canonicalUrl: input.canonicalUrl,
		title,
		metaDescription,
		visibleTextHash,
		offerOrPriceText,
		ctaText,
		formPresent,
	};
	const contentHash = await sha256Base64Url(serializedContentPayload(parts));

	return {
		normalizerVersion: COMPETITOR_PAGE_NORMALIZER_VERSION,
		canonicalUrl: input.canonicalUrl,
		title,
		metaDescription,
		visibleTextExcerpt,
		visibleTextHash,
		offerOrPriceText,
		ctaText,
		formPresent,
		contentHash,
	};
}

// ==== Batch selection ====

const PRIORITY_KINDS: readonly CompetitorSitePageKind[] = ["home", "pricing", "changelog"];

function compareByDiscovery(a: CompetitorSiteCandidate, b: CompetitorSiteCandidate): number {
	if (a.discoveryOrder !== b.discoveryOrder) return a.discoveryOrder - b.discoveryOrder;
	return a.canonicalUrl < b.canonicalUrl ? -1 : a.canonicalUrl > b.canonicalUrl ? 1 : 0;
}

function comparePriorityCandidates(a: CompetitorSiteCandidate, b: CompetitorSiteCandidate): number {
	const kindDiff = PRIORITY_KINDS.indexOf(a.kind) - PRIORITY_KINDS.indexOf(b.kind);
	if (kindDiff !== 0) return kindDiff;
	return compareByDiscovery(a, b);
}

function clampMaxPages(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return COMPETITOR_SITE_DEFAULT_MAX_PAGES_PER_RUN;
	}
	return Math.min(
		COMPETITOR_SITE_MAX_PAGES_PER_RUN,
		Math.max(1, Math.floor(value)),
	);
}

function startIndexFor(remaining: CompetitorSiteCandidate[], cursor: string | null): number {
	if (cursor === null) return 0;
	const target = Number.parseInt(cursor, 10);
	if (!Number.isFinite(target)) return 0;
	const index = remaining.findIndex((candidate) => candidate.discoveryOrder === target);
	return index === -1 ? 0 : index;
}

function nextCursorForRotation(
	remaining: CompetitorSiteCandidate[],
	rotated: CompetitorSiteCandidate[],
	takenCount: number,
): string | null {
	if (remaining.length === 0) return null;
	if (takenCount >= rotated.length) {
		// The whole rotation was consumed: wrap to the global start of the cycle.
		return String(remaining[0].discoveryOrder);
	}
	return String(rotated[takenCount].discoveryOrder);
}

/**
 * Select the next run batch: high-signal kinds first (home, pricing,
 * changelog — always included when present), then a fair stable rotation
 * through all remaining candidates continuing from priorState.nextCursor.
 * At most policy.maxPagesPerRun total (default/max 50).
 */
export function selectCompetitorSiteRunBatch(
	candidates: readonly CompetitorSiteCandidate[],
	priorState: CompetitorSiteRunState,
	policy: CompetitorSiteRunPolicy = {},
): CompetitorSiteRunBatch {
	const maxPages = clampMaxPages(policy.maxPagesPerRun);

	const priority = candidates
		.filter((candidate) => PRIORITY_KINDS.includes(candidate.kind))
		.sort(comparePriorityCandidates)
		.slice(0, maxPages);
	const remaining = candidates
		.filter((candidate) => !PRIORITY_KINDS.includes(candidate.kind))
		.sort(compareByDiscovery);

	const batch: CompetitorSiteCandidate[] = [...priority];
	const capacity = maxPages - batch.length;
	if (capacity <= 0 || remaining.length === 0) {
		// Rotation did not advance: preserve a still-valid prior cursor, else
		// restart the cycle at its beginning.
		let nextCursor: string | null = null;
		if (remaining.length > 0) {
			const target =
				priorState.nextCursor === null ? null : Number.parseInt(priorState.nextCursor, 10);
			nextCursor =
				target !== null && remaining.some((candidate) => candidate.discoveryOrder === target)
					? String(target)
					: String(remaining[0].discoveryOrder);
		}
		return { candidates: batch, nextCursor };
	}

	const start = startIndexFor(remaining, priorState.nextCursor);
	const rotated = [...remaining.slice(start), ...remaining.slice(0, start)];
	const taken = rotated.slice(0, capacity);
	batch.push(...taken);
	return {
		candidates: batch,
		nextCursor: nextCursorForRotation(remaining, rotated, taken.length),
	};
}

// ==== Change evaluation ====

const FIELD_PRIORITY: Record<CompetitorSiteChangeField, number> = {
	page: 0,
	title: 1,
	meta: 2,
	visibleText: 3,
	offerPrice: 4,
	cta: 5,
	form: 6,
};

function boundFactValue(value: string | null): string | null {
	if (value === null) return null;
	return value.length > COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT
		? value.slice(0, COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT)
		: value;
}

function formStateString(formPresent: boolean): string {
	return formPresent ? "present" : "absent";
}

function makePageFact(
	kind: CompetitorSiteChangeKind,
	canonicalUrl: string,
	before: string | null,
	after: string | null,
	materialReason: string,
	priorCaptureAt: string | null,
	currentCaptureAt: string | null,
	completenessEvidence: InventoryCompletenessEvidence,
): WebsitePageChange {
	return {
		kind,
		field: "page",
		canonicalUrl,
		before: boundFactValue(before),
		after: boundFactValue(after),
		material: true,
		materialReason,
		dedupeKey: `${kind}|page|${canonicalUrl}`,
		priorCaptureAt,
		currentCaptureAt,
		inventoryCompleteness: completenessEvidence,
	};
}

function evaluateFieldChanges(
	canonicalUrl: string,
	prior: NormalizedCompetitorPageContent,
	current: NormalizedCompetitorPageContent,
	priorCaptureAt: string | null,
	currentCaptureAt: string | null,
): WebsitePageChange[] {
	const changes: WebsitePageChange[] = [];
	const pushField = (
		field: CompetitorSiteChangeField,
		before: string | null,
		after: string | null,
		material: boolean,
		materialReason: string | null,
	): void => {
		if (before === after) return;
		changes.push({
			kind: "field-changed",
			field,
			canonicalUrl,
			before: boundFactValue(before),
			after: boundFactValue(after),
			material,
			materialReason,
			dedupeKey: `field-changed|${field}|${canonicalUrl}`,
			priorCaptureAt,
			currentCaptureAt,
			inventoryCompleteness: null,
		});
	};

	// Metadata fields are storable but not alertable.
	pushField("title", prior.title, current.title, false, null);
	pushField("meta", prior.metaDescription, current.metaDescription, false, null);
	// A visible-text fact is only produced when the normalized hashes differ AND
	// the bounded excerpts differ; normalization already suppressed cosmetic
	// churn, so any remaining observable difference is meaningful.
	if (
		prior.visibleTextHash !== current.visibleTextHash &&
		prior.visibleTextExcerpt !== current.visibleTextExcerpt
	) {
		pushField(
			"visibleText",
			prior.visibleTextExcerpt,
			current.visibleTextExcerpt,
			true,
			"meaningful visible text changed",
		);
	}
	// Offer/price and CTA changes are alertable.
	pushField(
		"offerPrice",
		prior.offerOrPriceText,
		current.offerOrPriceText,
		true,
		"offer or price changed",
	);
	pushField("cta", prior.ctaText, current.ctaText, true, "call to action changed");
	pushField(
		"form",
		formStateString(prior.formPresent),
		formStateString(current.formPresent),
		false,
		null,
	);
	return changes;
}

function compareFacts(a: WebsitePageChange, b: WebsitePageChange): number {
	if (a.canonicalUrl !== b.canonicalUrl) return a.canonicalUrl < b.canonicalUrl ? -1 : 1;
	const fieldDiff = FIELD_PRIORITY[a.field] - FIELD_PRIORITY[b.field];
	if (fieldDiff !== 0) return fieldDiff;
	return a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0;
}

/**
 * Compare a prior inventory to a current inventory and produce stable,
 * ordered change facts.
 *
 * Additions are always recorded (carrying completeness evidence). Removals are
 * only recorded when context.currentInventoryComplete is true. Field facts are
 * produced per changed field; cosmetic-only differences never reach here
 * because both sides are already normalized.
 */
export function evaluateWebsitePageChanges(
	previous: CompetitorPageInventory,
	current: CompetitorPageInventory,
	context: WebsiteChangeContext,
): WebsitePageChange[] {
	const changes: WebsitePageChange[] = [];
	const priorCaptureAt = context.priorCaptureAt ?? null;
	const currentCaptureAt = context.currentCaptureAt ?? null;
	const completenessEvidence: InventoryCompletenessEvidence = {
		priorInventoryComplete: context.priorInventoryComplete,
		currentInventoryComplete: context.currentInventoryComplete,
	};

	const currentUrls = new Set(current.keys());
	const previousUrls = new Set(previous.keys());
	const allUrls = new Set<string>([...previousUrls, ...currentUrls]);

	for (const canonicalUrl of [...allUrls].sort()) {
		const hasCurrent = currentUrls.has(canonicalUrl);
		const hadPrevious = previousUrls.has(canonicalUrl);
		if (hasCurrent && !hadPrevious) {
			changes.push(
				makePageFact(
					"page-added",
					canonicalUrl,
					null,
					canonicalUrl,
					"page added",
					null,
					currentCaptureAt,
					completenessEvidence,
				),
			);
			continue;
		}
		if (!hasCurrent && hadPrevious) {
			if (!context.currentInventoryComplete) continue;
			changes.push(
				makePageFact(
					"page-removed",
					canonicalUrl,
					canonicalUrl,
					null,
					"page removed",
					priorCaptureAt,
					null,
					completenessEvidence,
				),
			);
			continue;
		}
		changes.push(
			...evaluateFieldChanges(
				canonicalUrl,
				previous.get(canonicalUrl)!,
				current.get(canonicalUrl)!,
				priorCaptureAt,
				currentCaptureAt,
			),
		);
	}

	return changes.sort(compareFacts);
}
