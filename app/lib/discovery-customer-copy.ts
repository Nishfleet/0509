// Customer-facing rewrites for internal discovery status summaries.
//
// The discovery layer stores technical summaries ("Commercial discovery
// degraded and no cached results are available.") for operators and logs.
// Ops surfaces (app.ops, operator emails, D1 provider state) keep that
// wording; every customer-visible surface routes the summary through
// customerDiscoverySummary so customers read calm product language while
// the substance (delayed, retrying, cached, sample data) stays honest.

const RETRY_CLAUSE_PATTERN = /Retrying after about ([^.]+)\./i;

export function customerDiscoverySummary(
  summary: string | null | undefined,
): string | null {
  const raw = summary?.trim();
  if (!raw) {
    return null;
  }

  const retryMatch = raw.match(RETRY_CLAUSE_PATTERN);
  const retryClause = retryMatch
    ? `We'll retry in about ${retryMatch[1]}`
    : "We'll retry automatically";

  const cachedResultsAvailable =
    /serving cached results/i.test(raw) ||
    (/cached (live )?results are available/i.test(raw) &&
      !/no cached results are available/i.test(raw));

  if (/rate limited/i.test(raw)) {
    return cachedResultsAvailable
      ? `The ad source is briefly limiting checks, so we're showing your most recent results. ${retryClause}.`
      : `The ad source is briefly limiting checks and no recent results are saved for this search yet. ${retryClause} — results refresh as soon as checks recover.`;
  }

  if (/degraded/i.test(raw)) {
    return cachedResultsAvailable
      ? `Live ad checks are temporarily delayed, so we're showing your most recent results. ${retryClause}.`
      : `Live ad checks are temporarily delayed. ${retryClause} — results refresh as soon as checks recover.`;
  }

  if (/already warming this query/i.test(raw)) {
    return "We're checking this competitor now. Results should appear shortly.";
  }

  if (/running through Browser Run\.$/i.test(raw)) {
    return "Live ad checks are running normally.";
  }

  if (/configured through Browser Run, but provider health has not been confirmed/i.test(raw)) {
    return "Live ad checks are set up. The next check confirms everything is healthy.";
  }

  if (/API fallback is available while browser capture is unavailable/i.test(raw)) {
    return "Visual ad checks are temporarily delayed; a backup Meta check is filling in.";
  }

  if (/API fallback failed while browser capture is unavailable/i.test(raw) ||
      /diagnostic fetch failed/i.test(raw)) {
    return "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.";
  }

  if (/No live commercial discovery provider is configured/i.test(raw)) {
    return "Live ad checks aren't configured yet, so searches show labeled sample data.";
  }

  // Unknown summaries: soften the register without changing substance.
  return raw
    .replace(/Live commercial discovery/gi, "Live ad checks")
    .replace(/Commercial discovery/g, "Competitor ad checks")
    .replace(/commercial discovery/g, "competitor ad checks")
    .replace(/Browser Run/gi, "visual checks")
    .replace(/Official Meta API/gi, "the backup Meta check")
    .replace(/API fallback/gi, "the backup Meta check")
    .replace(/cached live results/gi, "recent results")
    .replace(/cached results/gi, "recent results")
    .replace(/demo mode/gi, "sample mode")
    .replace(/query/gi, "competitor")
    .replace(/(^|[.!?]\s+)([a-z])/g, (match) => match.toUpperCase());
}
