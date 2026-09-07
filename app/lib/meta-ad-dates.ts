/**
 * Parsing for the Meta Ad Library "Started running on <date>" card line.
 *
 * The Ad Library publishes each ad's start date on every card. The browser
 * scraper captures that line raw (per extraction path) and this module turns
 * it into the same date-only ISO shape the Meta API path uses for
 * `ad_delivery_start_time` (`YYYY-MM-DD`). Anything unparseable maps to null —
 * an honest "unknown", never a guessed date.
 */

const STARTED_RUNNING_LINE_PATTERN = /^started running on\b/i;
const STARTED_RUNNING_PREFIX = /^started running on\s+/i;

const MONTHS_BY_NAME: Record<string, number> = {
	jan: 0,
	january: 0,
	feb: 1,
	february: 1,
	mar: 2,
	march: 2,
	apr: 3,
	april: 3,
	may: 4,
	jun: 5,
	june: 5,
	jul: 6,
	july: 6,
	aug: 7,
	august: 7,
	sep: 8,
	sept: 8,
	september: 8,
	oct: 9,
	october: 9,
	nov: 10,
	november: 10,
	dec: 11,
	december: 11,
};

// "Jul 12, 2026" / "July 12, 2026" (comma optional in some renderings).
const MONTH_FIRST_DATE = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/;
// "12 Jul 2026" / "12 July 2026".
const DAY_FIRST_DATE = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/;

function toIsoDate(year: number, monthIndex: number, day: number): string | null {
	const candidate = new Date(Date.UTC(year, monthIndex, day));
	const isRealCalendarDate =
		candidate.getUTCFullYear() === year &&
		candidate.getUTCMonth() === monthIndex &&
		candidate.getUTCDate() === day;

	if (!isRealCalendarDate) {
		return null;
	}

	return candidate.toISOString().slice(0, 10);
}

/**
 * Finds the raw "Started running on …" line inside newline-separated card
 * text. Returns the untouched line so parsing stays in one server-side place.
 */
export function findStartedRunningLine(text: string | null | undefined): string | null {
	if (!text) {
		return null;
	}

	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (STARTED_RUNNING_LINE_PATTERN.test(line)) {
			return line;
		}
	}

	return null;
}

/**
 * Parses a captured "Started running on <date>" line into a `YYYY-MM-DD`
 * ISO date — the same shape the Meta API path stores for
 * `ad_delivery_start_time`. Handles "Jul 12, 2026" and "12 Jul 2026" (short
 * or full month names); trailing card metadata after "·" is ignored.
 * Unparseable input returns null.
 */
export function parseStartedRunningDate(line: string | null | undefined): string | null {
	if (!line) {
		return null;
	}

	const withoutPrefix = line.trim().replace(STARTED_RUNNING_PREFIX, "");
	// Cards can append "· Total active time …" after the date.
	const dateText = withoutPrefix.split(/[·•]/)[0]?.trim().replace(/\.$/, "") ?? "";
	if (!dateText) {
		return null;
	}

	const monthFirst = dateText.match(MONTH_FIRST_DATE);
	if (monthFirst) {
		const monthIndex = MONTHS_BY_NAME[monthFirst[1].toLowerCase()];
		if (monthIndex === undefined) {
			return null;
		}
		return toIsoDate(Number(monthFirst[3]), monthIndex, Number(monthFirst[2]));
	}

	const dayFirst = dateText.match(DAY_FIRST_DATE);
	if (dayFirst) {
		const monthIndex = MONTHS_BY_NAME[dayFirst[2].toLowerCase()];
		if (monthIndex === undefined) {
			return null;
		}
		return toIsoDate(Number(dayFirst[3]), monthIndex, Number(dayFirst[1]));
	}

	return null;
}
