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
 */

/** Matches an HTML comment block. Non-greedy so nested comments unwind over loop passes. */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
/** Orphan comment delimiters left after a block pass (unclosed comments, stray `-->`). */
const COMMENT_DELIMITER_PATTERN = /<!--|-->|<!>/g;

/** Matches script open or close tags, including attribute-bearing and malformed closers. */
const SCRIPT_TAG_PATTERN = /<\/?script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const STYLE_TAG_PATTERN = /<\/?style\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

const SCRIPT_BLOCK_PATTERN =
	/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const STYLE_BLOCK_PATTERN =
	/<style\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/style\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

/** Matches any remaining HTML tag, including malformed/self-closing variants. */
const ANY_TAG_PATTERN = /<[^>]+>/g;

function stripScriptAndStyleMarkup(value: string): string {
	let result = value;
	let previous: string;
	do {
		previous = result;
		result = result.replace(HTML_COMMENT_PATTERN, "");
		result = result.replace(COMMENT_DELIMITER_PATTERN, "");
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
