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
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
  /\b(?:api[_ -]?key|secret|token|password|customer[_ -]?id|user[_ -]?id)\s*[:=]\s*\S{4,}/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|[^/]+\.internal)\b/i,
  /https:\/\/github\.com\/Nishfleet\/0509(?:\/|\b)/i,
];

/** @param {string} content @param {string} heading */
function sectionContent(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.match(new RegExp(`${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1]?.trim() ?? "";
}

/** @param {string} content */
export function sensitiveContentIssues(content) {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(content)) ? ["sensitive_content_detected"] : [];
}

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
  for (const section of REQUIRED_SECTIONS.filter((heading) => heading.startsWith("## "))) {
    if (sectionContent(content, section).length < 12) issues.push(`empty_section:${section}`);
  }
  const evidenceWindow = sectionContent(content, "## Evidence window");
  if (!evidenceWindow.includes("UTC") || (evidenceWindow.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g) || []).length < 4) {
    issues.push("invalid_evidence_window");
  }
  const receipts = sectionContent(content, "## Receipts");
  if (!/\d|https:\/\//.test(receipts)) issues.push("missing_receipt_evidence");
  const confidence = sectionContent(content, "## Confidence and falsification test");
  if (!/\b(?:low|medium|high)\b/i.test(confidence) || !/\b(?:if|when|threshold|wrong|falsif)/i.test(confidence)) {
    issues.push("invalid_confidence_or_falsification");
  }
  if (!/\b(?:ok|failed|unavailable)\b/i.test(sectionContent(content, "## Source health"))) issues.push("invalid_source_health");
  if (!content.includes(reportDate)) issues.push("wrong_report_date");
  const unavailableSection = content.match(/## Unavailable sources\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
  for (const source of ["PostHog", "CRM", "call-transcript", "external support-platform"]) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`${escaped}[^\\n]*unavailable[^\\n]*(?:not checked|was not checked)`, "i").test(unavailableSection)) {
      issues.push(`missing_unavailable_source_status:${source}`);
    }
  }
  issues.push(...sensitiveContentIssues(content));
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
  if (!isValidReportDate(reportDate) || paths.length !== 3) {
    throw new Error("Usage: validate-market-signal-report.mjs --date YYYY-MM-DD CURRENT RAW TELEGRAM");
  }

  const failures = paths.slice(0, 2).flatMap((path) => validateReport(readFileSync(path, "utf8"), reportDate).map((issue) => `${path}:${issue}`));
  failures.push(...sensitiveContentIssues(readFileSync(paths[2], "utf8")).map((issue) => `${paths[2]}:${issue}`));
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
