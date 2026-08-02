import { readFileSync } from "node:fs";

const REQUIRED_FRONTMATTER_VALUES = {
  authored_by: "hermes-vps",
  writer_surface: "hermes",
  tier: "raw",
  status: "captured",
  verification_status: "verified",
  council_status: "not_required",
  human_locked: "false",
};

const REQUIRED_FRONTMATTER_KEYS = ["writer_model", "derived_from", "sources", "last_verified"];

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
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontmatterMatch) issues.push(content.startsWith("---\n") ? "unclosed_frontmatter" : "missing_frontmatter");
  const frontmatter = frontmatterMatch?.[1] ?? "";
  const fields = new Map(
    frontmatter.split("\n").flatMap((line) => {
      const match = line.match(/^([a-z_]+):\s*(.*)$/);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
  for (const [key, expected] of Object.entries(REQUIRED_FRONTMATTER_VALUES)) {
    if (fields.get(key) !== expected) issues.push(`invalid_frontmatter_field:${key}`);
  }
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!fields.has(key) || !fields.get(key)) issues.push(`missing_frontmatter_field:${key}`);
  }
  if (fields.get("last_verified") !== reportDate) issues.push("invalid_frontmatter_field:last_verified");
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) issues.push(`missing_section:${section}`);
  }
  if (!content.includes(reportDate)) issues.push("wrong_report_date");
  const unavailableSection = content.match(/## Unavailable sources\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
  for (const source of ["PostHog", "CRM", "call-transcript", "external support-platform"]) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`${escaped}[^\\n]*(?:unavailable|failed)`, "i").test(unavailableSection)) {
      issues.push(`missing_unavailable_source_status:${source}`);
    }
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) issues.push("sensitive_content_detected");
  }
  return [...new Set(issues)];
}

/** @param {string} reportDate */
export function isValidReportDate(reportDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return false;
  const parsed = new Date(`${reportDate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === reportDate;
}

function main() {
  const dateIndex = process.argv.indexOf("--date");
  const reportDate = dateIndex >= 0 ? process.argv[dateIndex + 1] : "";
  const paths = process.argv.slice(2).filter((value, index, args) => value !== "--date" && args[index - 1] !== "--date");
  if (!isValidReportDate(reportDate) || paths.length !== 2) {
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
