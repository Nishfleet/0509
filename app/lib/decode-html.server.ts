/**
 * Single-pass HTML entity decoder for untrusted parsed text.
 *
 * Decodes each entity at most once: the replacement output is never re-scanned,
 * so an already-decoded `&` in the input stays `&` and cannot re-emerge as a
 * live entity for a downstream HTML sink (React text, email HTML body, etc.).
 * This is the one decoder the codebase uses for competitor / Meta Ad Library /
 * landing-page / browser-run / website-identity / presence text that may have
 * already been HTML-decoded by an upstream parser — see Nishfleet/0509#931.
 *
 * Handles the named entities in `ENTITY_MAP` plus numeric `&#NNN;` and
 * `&#xHHH;` forms. Unknown entities are left intact. A non-string input
 * (e.g. `undefined`) returns `""` rather than throwing, so callers that
 * previously guarded with `?? ""` keep identical behavior.
 */
const ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	copy: "©",
	reg: "®",
	trade: "™",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	times: "×",
	middot: "·",
	bull: "•",
	plusmn: "±",
	deg: "°",
	cent: "¢",
	pound: "£",
	euro: "€",
	yen: "¥",
	sect: "§",
	para: "¶",
	laquo: "«",
	raquo: "»",
	permil: "‰",
	micro: "µ",
	sup2: "²",
	sup3: "³",
	frac12: "½",
	frac14: "¼",
	frac34: "¾",
	aacute: "á",
	eacute: "é",
	iacute: "í",
	oacute: "ó",
	uacute: "ú",
	agrave: "à",
	egrave: "è",
	igrave: "ì",
	ograve: "ò",
	ugrave: "ù",
	ntilde: "ñ",
	ccedil: "ç",
	szlig: "ß",
	aring: "å",
	auml: "ä",
	euml: "ë",
	iuml: "ï",
	ouml: "ö",
	uuml: "ü",
	yuml: "ÿ",
};

export function decodeHtmlEntities(value: string): string {
	if (typeof value !== "string") return "";
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, body: string) => {
		const lower = body.toLowerCase();
		if (lower.startsWith("#x")) {
			const code = Number.parseInt(lower.slice(2), 16);
			if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
			return match;
		}
		if (lower.startsWith("#")) {
			const code = Number.parseInt(lower.slice(1), 10);
			if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
			return match;
		}
		const mapped = ENTITY_MAP[lower];
		return mapped !== undefined ? mapped : match;
	});
}
