import { readFileSync } from "node:fs";

const REQUIRED_FRONTMATTER = [
  "authored_by: hermes-vps",
  "writer_surface: hermes",
  "tier: raw",
  "status: captured",
  "derived_from:",
  "sources:",
  "last_verified:",
  "verification_status:",
  "council_status:",
  "human_locked:",
];

const REQUIRED_SECTIONS = [
  "# What the market is telling 0509",
  "## Evidence window",
  "## Strongest changes",
  "## Receipts",
  "## Decision affected",
  "## Confidence and falsification test",
  "## Source health",
  "## Unavailable sources",
];

const FORBIDDEN_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:ghp|gho)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/,
];

/**
 * @param {string} content
 * @param {string} reportDate
 * @returns {string[]}
 */
export function validateReport(content, reportDate) {
  const issues = [];
  if (!content.startsWith("---\n")) issues.push("missing_frontmatter");
  for (const field of REQUIRED_FRONTMATTER) {
    if (!content.includes(field)) issues.push(`missing_frontmatter_field:${field}`);
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) issues.push(`missing_section:${section}`);
  }
  if (!content.includes(reportDate)) issues.push("wrong_report_date");
  for (const source of ["PostHog", "CRM", "call-transcript", "external support-platform"]) {
    if (!content.includes(source)) issues.push(`missing_unavailable_source:${source}`);
  }
  if (!/unavailable|failed/i.test(content)) issues.push("missing_source_status");
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) issues.push("sensitive_content_detected");
  }
  return [...new Set(issues)];
}

function main() {
  const dateIndex = process.argv.indexOf("--date");
  const reportDate = dateIndex >= 0 ? process.argv[dateIndex + 1] : "";
  const paths = process.argv.slice(2).filter((value, index, args) => value !== "--date" && args[index - 1] !== "--date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || paths.length !== 2) {
    throw new Error("Usage: validate-market-signal-report.mjs --date YYYY-MM-DD CURRENT RAW");
  }

  const failures = paths.flatMap((path) => validateReport(readFileSync(path, "utf8"), reportDate).map((issue) => `${path}:${issue}`));
  if (failures.length > 0) throw new Error(failures.join(","));
  process.stdout.write(`market_signal_report_valid date=${reportDate}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`market_signal_report_invalid: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
