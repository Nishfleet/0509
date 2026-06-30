import { emptyCompetitorWebsite, normalizeCompetitorWebsiteInput, watchlistFingerprint } from "~/lib/competitor-website";
import { isSecretishMemoryString } from "~/lib/agent-redaction";
import { normalizeSavedQuery } from "~/lib/normalize";
import type { NormalizedSavedQuery, WatchTargetType, WatchlistTrackingRole } from "~/lib/types";

export const COMPETITOR_IMPORT_MAX_BYTES = 200_000;
export const COMPETITOR_IMPORT_MAX_ROWS = 250;

export type CompetitorImportRowStatus = "valid" | "invalid" | "duplicate" | "existing" | "over_cap";

export interface CompetitorImportPreviewInput {
  rawText: string;
  country: string;
  planLimit: number;
  currentCount: number;
  existingFingerprints?: readonly string[];
  selectedRowIds?: readonly string[] | null;
  maxBytes?: number;
  maxRows?: number;
}

export interface CompetitorImportWatchlistInput {
  name: string;
  targetType: WatchTargetType;
  targetId: string;
  targetFingerprint: string;
  targetLabel: string;
  targetCountry: string;
  trackingRole: WatchlistTrackingRole;
}

export interface CompetitorImportRow {
  id: string;
  rowNumber: number;
  raw: string;
  name: string | null;
  website: string | null;
  normalizedUrl: string | null;
  host: string | null;
  notes: string | null;
  tags: string[];
  client: string | null;
  status: CompetitorImportRowStatus;
  reason: string | null;
  selected: boolean;
  target: CompetitorImportWatchlistInput | null;
}

export interface CompetitorImportPreview {
  ok: boolean;
  error: string | null;
  planLimit: number;
  currentCount: number;
  availableSlots: number;
  selectedCount: number;
  rows: CompetitorImportRow[];
  summary: Record<CompetitorImportRowStatus, number>;
}

interface ParsedImportRow {
  rowNumber: number;
  raw: string;
  name: string | null;
  website: string | null;
  notes: string | null;
  tags: string[];
  client: string | null;
}

const KNOWN_NAME_HEADERS = ["name", "company", "brand", "competitor", "advertiser"];
const KNOWN_WEBSITE_HEADERS = ["domain", "website", "url", "site"];
const KNOWN_NOTES_HEADERS = ["note", "notes", "description"];
const KNOWN_TAG_HEADERS = ["tag", "tags"];
const KNOWN_CLIENT_HEADERS = ["client", "account", "customer"];

export function buildCompetitorImportPreview(input: CompetitorImportPreviewInput): CompetitorImportPreview {
  const maxBytes = input.maxBytes ?? COMPETITOR_IMPORT_MAX_BYTES;
  const maxRows = input.maxRows ?? COMPETITOR_IMPORT_MAX_ROWS;
  const byteLength = new TextEncoder().encode(input.rawText).length;
  const planLimit = Math.max(0, Math.floor(input.planLimit));
  const currentCount = Math.max(0, Math.floor(input.currentCount));
  const availableSlots = Math.max(0, planLimit - currentCount);

  if (byteLength > maxBytes) {
    return emptyPreview({
      error: `Import is too large. Paste or upload ${Math.floor(maxBytes / 1024)} KB or less.`,
      planLimit,
      currentCount,
      availableSlots,
    });
  }

  const parsedRows = parseCompetitorImportRows(input.rawText, maxRows);
  if (parsedRows.error) {
    return emptyPreview({
      error: parsedRows.error,
      planLimit,
      currentCount,
      availableSlots,
    });
  }

  const existingFingerprints = new Set(input.existingFingerprints ?? []);
  const seenFingerprints = new Map<string, number>();
  const selectedIds = input.selectedRowIds ? new Set(input.selectedRowIds) : null;
  let autoSelectedEligibleCount = 0;
  let explicitSelectedEligibleCount = 0;

  const rows = parsedRows.rows.map((parsed) => {
    const prepared = prepareImportRow(parsed, input.country);
    const base = {
      id: `row-${parsed.rowNumber}`,
      rowNumber: parsed.rowNumber,
      raw: parsed.raw,
      name: prepared.name,
      website: prepared.website,
      normalizedUrl: prepared.normalizedUrl,
      host: prepared.host,
      notes: prepared.notes,
      tags: prepared.tags,
      client: prepared.client,
      selected: false,
    };

    if (!prepared.target) {
      return {
        ...base,
        status: "invalid" as const,
        reason: prepared.reason ?? "Add a competitor name, domain, or URL.",
        target: null,
      };
    }

    const duplicateOf = seenFingerprints.get(prepared.target.targetFingerprint);
    seenFingerprints.set(prepared.target.targetFingerprint, parsed.rowNumber);
    if (duplicateOf) {
      return {
        ...base,
        status: "duplicate" as const,
        reason: `Duplicate of row ${duplicateOf}.`,
        target: prepared.target,
      };
    }

    if (existingFingerprints.has(prepared.target.targetFingerprint)) {
      return {
        ...base,
        status: "existing" as const,
        reason: "Already tracked in this workspace.",
        target: prepared.target,
      };
    }

    const selected = selectedIds ? selectedIds.has(`row-${parsed.rowNumber}`) : autoSelectedEligibleCount < availableSlots;
    const selectedOrdinal = selectedIds ? explicitSelectedEligibleCount : autoSelectedEligibleCount;
    if (selected) {
      if (selectedIds) {
        explicitSelectedEligibleCount += 1;
      } else {
        autoSelectedEligibleCount += 1;
      }
    } else if (!selectedIds) {
      autoSelectedEligibleCount += 1;
    }

    if ((selectedIds ? selected && selectedOrdinal >= availableSlots : autoSelectedEligibleCount > availableSlots)) {
      return {
        ...base,
        selected: false,
        status: "over_cap" as const,
        reason: "Over the current plan limit. Select fewer competitors or upgrade.",
        target: prepared.target,
      };
    }

    return {
      ...base,
      selected,
      status: "valid" as const,
      reason: prepared.normalizedUrl ? "Ready to track as a website competitor." : "Ready to track as a competitor name.",
      target: prepared.target,
    };
  });

  const summary = summarizeImportRows(rows);
  return {
    ok: !rows.some((row) => row.status === "invalid") && rows.length > 0,
    error: rows.length > 0 ? null : "Paste at least one competitor name, domain, or URL.",
    planLimit,
    currentCount,
    availableSlots,
    selectedCount: rows.filter((row) => row.selected && row.status === "valid").length,
    rows,
    summary,
  };
}

export function neutralizeCsvFormulaCell(value: string) {
  return /^[\t\r=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

function emptyPreview(input: {
  error: string;
  planLimit: number;
  currentCount: number;
  availableSlots: number;
}): CompetitorImportPreview {
  return {
    ok: false,
    error: input.error,
    planLimit: input.planLimit,
    currentCount: input.currentCount,
    availableSlots: input.availableSlots,
    selectedCount: 0,
    rows: [],
    summary: emptySummary(),
  };
}

function parseCompetitorImportRows(rawText: string, maxRows: number): { rows: ParsedImportRow[]; error: string | null } {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { rows: [], error: null };
  }

  const csv = parseCsvRecords(trimmed);
  const rows = shouldUseCsvRows(csv)
    ? parsedRowsFromCsv(csv)
    : trimmed
      .split(/\r?\n/)
      .map((line, index) => parsedRowFromLine(line, index + 1))
      .filter((row): row is ParsedImportRow => Boolean(row));

  if (rows.length > maxRows) {
    return {
      rows: [],
      error: `Import has ${rows.length} rows. Keep one import to ${maxRows} rows or fewer.`,
    };
  }

  return { rows, error: null };
}

function shouldUseCsvRows(records: string[][]) {
  if (records.length === 0 || records.every((record) => record.length <= 1)) {
    return false;
  }
  return hasKnownHeader(records[0] ?? []) || records.some((record) => record.length > 2);
}

function parsedRowsFromCsv(records: string[][]) {
  const header = records[0] ?? [];
  const hasHeader = hasKnownHeader(header);
  const headerMap = hasHeader ? buildHeaderMap(header) : null;
  const dataRows = hasHeader ? records.slice(1) : records;

  return dataRows
    .map((record, index) => {
      const rowNumber = index + (hasHeader ? 2 : 1);
      const raw = record.join(", ").trim();
      if (!raw) return null;
      const name = headerMap ? readMappedCell(record, headerMap.name) : cleanCell(record[0]);
      const website = headerMap ? readMappedCell(record, headerMap.website) : cleanCell(record[1]);
      return {
        rowNumber,
        raw,
        name,
        website,
        notes: headerMap ? readMappedCell(record, headerMap.notes) : cleanCell(record[2]),
        tags: splitTags(headerMap ? readMappedCell(record, headerMap.tags) : cleanCell(record[3])),
        client: headerMap ? readMappedCell(record, headerMap.client) : cleanCell(record[4]),
      };
    })
    .filter((row): row is ParsedImportRow => Boolean(row));
}

function parsedRowFromLine(line: string, rowNumber: number): ParsedImportRow | null {
  const raw = line.trim();
  if (!raw) return null;
  const website = extractWebsiteToken(raw);
  const name = website ? cleanName(raw.replace(website, " ")) : cleanName(raw);
  return {
    rowNumber,
    raw,
    name,
    website,
    notes: null,
    tags: [],
    client: null,
  };
}

function prepareImportRow(row: ParsedImportRow, country: string): {
  name: string | null;
  website: string | null;
  normalizedUrl: string | null;
  host: string | null;
  notes: string | null;
  tags: string[];
  client: string | null;
  target: CompetitorImportWatchlistInput | null;
  reason: string | null;
} {
  if (isSecretishMemoryString(row.raw)) {
    return invalidPreparedRow(row, "This row looks like it contains a secret or private link. Remove it before importing.");
  }

  const websiteInput = row.website?.trim() || extractWebsiteToken(row.raw) || "";
  const normalizedWebsite = websiteInput ? normalizeCompetitorWebsiteInput(websiteInput) : emptyCompetitorWebsite();
  if (websiteInput && normalizedWebsite.error) {
    return invalidPreparedRow(row, normalizedWebsite.error);
  }

  const name = cleanName(row.name ?? "") || normalizedWebsite.displayName;
  const query = normalizedWebsite.searchTerm || name;
  if (!query || query.length < 2) {
    return invalidPreparedRow(row, "Add a competitor name, domain, or URL.");
  }

  const normalizedQuery = normalizeSavedQuery("advertiser", {
    query,
    country,
  });
  const targetFingerprint = watchlistFingerprint(normalizedQuery, normalizedWebsite);
  const targetLabel = normalizedWebsite.displayName ?? name ?? query;
  const targetId = normalizedWebsite.normalizedUrl ?? normalizedQuery.filters.query;

  return {
    name,
    website: websiteInput || null,
    normalizedUrl: normalizedWebsite.normalizedUrl,
    host: normalizedWebsite.host,
    notes: cleanCell(row.notes),
    tags: row.tags,
    client: cleanCell(row.client),
    target: {
      name: `${targetLabel} watch`,
      targetType: "advertiser",
      targetId,
      targetFingerprint,
      targetLabel,
      targetCountry: normalizedQuery.filters.country,
      trackingRole: "competitor",
    },
    reason: null,
  };
}

function invalidPreparedRow(row: ParsedImportRow, reason: string) {
  return {
    name: cleanName(row.name ?? ""),
    website: cleanCell(row.website),
    normalizedUrl: null,
    host: null,
    notes: cleanCell(row.notes),
    tags: row.tags,
    client: cleanCell(row.client),
    target: null,
    reason,
  };
}

function parseCsvRecords(input: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      record.push(cleanCell(cell) ?? "");
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      record.push(cleanCell(cell) ?? "");
      if (record.some((value) => value.trim())) {
        records.push(record);
      }
      record = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  record.push(cleanCell(cell) ?? "");
  if (record.some((value) => value.trim())) {
    records.push(record);
  }
  return records;
}

function hasKnownHeader(header: string[]) {
  const normalized = header.map(normalizeHeader);
  return normalized.some((value) =>
    [...KNOWN_NAME_HEADERS, ...KNOWN_WEBSITE_HEADERS, ...KNOWN_NOTES_HEADERS, ...KNOWN_TAG_HEADERS, ...KNOWN_CLIENT_HEADERS]
      .includes(value)
  );
}

function buildHeaderMap(header: string[]) {
  const normalized = header.map(normalizeHeader);
  return {
    name: findHeaderIndex(normalized, KNOWN_NAME_HEADERS),
    website: findHeaderIndex(normalized, KNOWN_WEBSITE_HEADERS),
    notes: findHeaderIndex(normalized, KNOWN_NOTES_HEADERS),
    tags: findHeaderIndex(normalized, KNOWN_TAG_HEADERS),
    client: findHeaderIndex(normalized, KNOWN_CLIENT_HEADERS),
  };
}

function findHeaderIndex(header: string[], names: string[]) {
  const index = header.findIndex((value) => names.includes(value));
  return index >= 0 ? index : null;
}

function readMappedCell(record: string[], index: number | null) {
  return index === null ? null : cleanCell(record[index]);
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function extractWebsiteToken(value: string) {
  const urlMatch = value.match(/https?:\/\/[^\s,;|]+/i);
  if (urlMatch) return trimTrailingPunctuation(urlMatch[0]);
  const domainMatch = value.match(/\b(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s,;|]*)?/i);
  return domainMatch ? trimTrailingPunctuation(domainMatch[0]) : null;
}

function trimTrailingPunctuation(value: string) {
  return value.replace(/[).,\];]+$/g, "");
}

function cleanCell(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function cleanName(value: string) {
  return cleanCell(value.replace(/^[,;|:\-\s]+|[,;|:\-\s]+$/g, ""));
}

function splitTags(value: string | null) {
  return (value ?? "")
    .split(/[;|,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function summarizeImportRows(rows: CompetitorImportRow[]) {
  const summary = emptySummary();
  for (const row of rows) {
    summary[row.status] += 1;
  }
  return summary;
}

function emptySummary(): Record<CompetitorImportRowStatus, number> {
  return {
    valid: 0,
    invalid: 0,
    duplicate: 0,
    existing: 0,
    over_cap: 0,
  };
}
