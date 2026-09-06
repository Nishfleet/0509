/**
 * Strip executable markup from untrusted HTML before plain-text extraction.
 * Handles malformed script/style closers, nested comments, and smuggled tags.
 *
 * Every multi-character pattern is applied inside a fixpoint loop so that
 * removing one occurrence cannot re-introduce the dangerous sequence it
 * matches. This is the CodeQL `js/incomplete-multi-character-sanitization`
 * concern: a single-pass replace over `<scr<script>ipt>` leaves `<script>`,
 * and a single-pass replace over `<!--<!-- -->` can leave `<!--`. Looping
 * until the string stops changing closes that gap.
 *
 * HTML comments are stripped with literal scans, not an empty regex replace
 * of `<!--`. CodeQL still flags `value.replace(/<!--.../, "")` even when that
 * call sits inside a fixpoint loop (alerts #59 and #60).
 */

/** Matches script open or close tags, including attribute-bearing and malformed closers. */
const SCRIPT_TAG_PATTERN = /<\/?script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const STYLE_TAG_PATTERN = /<\/?style\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

const SCRIPT_BLOCK_PATTERN =
	/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const STYLE_BLOCK_PATTERN =
	/<style\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/style\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

/** Matches any remaining HTML tag, including malformed/self-closing variants. */
const ANY_TAG_PATTERN = /<[^>]+>/g;

const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const COMMENT_CLOSE_BANG = "--!>";
const COMMENT_BANG_ONLY = "<!>";

function eraseLiteral(haystack: string, needle: string): string {
	return haystack.split(needle).join("");
}

function commentCloserAfter(
	value: string,
	from: number,
): { at: number; length: number } | null {
	const bang = value.indexOf(COMMENT_CLOSE_BANG, from);
	const normal = value.indexOf(COMMENT_CLOSE, from);
	if (bang === -1 && normal === -1) return null;
	if (bang === -1 || (normal !== -1 && normal <= bang)) {
		return { at: normal, length: COMMENT_CLOSE.length };
	}
	return { at: bang, length: COMMENT_CLOSE_BANG.length };
}

/**
 * Remove `<!-- ... -->` / `<!-- ... --!>` blocks, including nested leftover
 * openers that the inner closer binds to (non-greedy, first closer wins).
 */
function stripHtmlCommentBlocks(value: string): string {
	let result = value;
	let start = 0;
	while ((start = result.indexOf(COMMENT_OPEN, start)) !== -1) {
		const closer = commentCloserAfter(result, start + COMMENT_OPEN.length);
		if (!closer) break;
		result = result.slice(0, start) + result.slice(closer.at + closer.length);
	}
	return result;
}

/**
 * Strip HTML comments until stable. Nested sequences such as
 * `<<!--- x --->>` and `<!<!---->` cannot re-form `<!--` after one pass.
 */
function stripHtmlComments(value: string): string {
	let result = value;
	let previous: string;
	do {
		previous = result;
		result = stripHtmlCommentBlocks(result);
		result = eraseLiteral(result, COMMENT_OPEN);
		result = eraseLiteral(result, COMMENT_CLOSE_BANG);
		result = eraseLiteral(result, COMMENT_CLOSE);
		result = eraseLiteral(result, COMMENT_BANG_ONLY);
	} while (result !== previous);
	return result;
}

function stripScriptAndStyleMarkup(value: string): string {
	let result = value;
	let previous: string;
	do {
		previous = result;
		result = stripHtmlComments(result);
		result = result.replace(SCRIPT_BLOCK_PATTERN, " ");
		result = result.replace(STYLE_BLOCK_PATTERN, " ");
		result = result.replace(SCRIPT_TAG_PATTERN, " ");
		result = result.replace(STYLE_TAG_PATTERN, " ");
	} while (result !== previous);
	return result;
}

/**
 * Remove HTML comments, then strip every script/style element (content included)
 * and any orphaned script/style tags left by malformed markup. All patterns run
 * inside a fixpoint loop so smuggled sequences (`<scr<script>ipt>`, nested
 * `<!-- ... -->`) cannot re-emerge after a single pass.
 */
export function stripScriptAndStyle(value: string): string {
	if (value === "") return value;
	return stripScriptAndStyleMarkup(value);
}

/**
 * Strip every remaining HTML tag from `value`. Applied inside a fixpoint loop
 * so smuggled tags (`<scri<script>pt>`) cannot re-form `<script>` after a
 * single pass. Use after `stripScriptAndStyle` for plain-text extraction from
 * untrusted HTML. Replaces each tag with the empty string, matching the
 * behaviour of the local `/<[^>]+>/g` strips this consolidates.
 */
export function stripAllTags(value: string): string {
	if (value === "") return value;
	let result = value;
	let previous: string;
	do {
		previous = result;
		result = result.replace(ANY_TAG_PATTERN, "");
	} while (result !== previous);
	return result;
}
