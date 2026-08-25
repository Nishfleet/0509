/**
 * Strip executable markup from untrusted HTML before plain-text extraction.
 * Handles malformed script/style closers that naive regexes miss.
 */

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/** Matches script/style open or close tags, including malformed closers. */
const SCRIPT_TAG_PATTERN = /<\/?script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const STYLE_TAG_PATTERN = /<\/?style\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

const SCRIPT_BLOCK_PATTERN =
	/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const STYLE_BLOCK_PATTERN =
	/<style\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/style\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function stripScriptAndStyleMarkup(value: string): string {
	let result = value;
	let previous: string;
	do {
		previous = result;
		result = result.replace(SCRIPT_BLOCK_PATTERN, " ");
		result = result.replace(STYLE_BLOCK_PATTERN, " ");
		result = result.replace(SCRIPT_TAG_PATTERN, " ");
		result = result.replace(STYLE_TAG_PATTERN, " ");
	} while (result !== previous);
	return result;
}

/**
 * Remove HTML comments, then strip every script/style element (content included)
 * and any orphaned script/style tags left by malformed markup.
 */
export function stripScriptAndStyle(value: string): string {
	if (value === "") return value;
	const withoutComments = value.replace(HTML_COMMENT_PATTERN, "");
	return stripScriptAndStyleMarkup(withoutComments);
}
