export const DOCUMENTED_PER_BRAND_PER_DAY = {
  d1_rows_written: 10,
  r2_class_a: 10,
  browser_rendering_seconds: 15,
} as const;

export const COST_REGRESSION_MULTIPLE = 3;

export type CostLine = keyof typeof DOCUMENTED_PER_BRAND_PER_DAY;

export interface CostAlert {
  id: string;
  line: CostLine;
  measured: number;
  expected: number;
  day: string;
  total: number;
  onBrands: number;
}

export interface CostTotals {
  d1_rows_written: number;
  r2_class_a: number;
  browser_rendering_seconds: number;
}

export interface CostGuardResult {
  day: string;
  onBrands: number;
  totals: CostTotals;
  perBrand: CostTotals;
  expected: CostTotals;
  alerts: CostAlert[];
}

export interface CostGuardInput {
  graphql?: unknown;
  accountId?: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
  onBrands: number;
  now?: Date;
  day?: string;
  writeAlert: (row: CostAlert) => Promise<{ id: string }> | { id: string };
  expectedPerBrandPerDay?: Partial<CostTotals>;
}

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const GROUP_LIMIT = {
  d1: 10,
  r2: 100,
  browser: 10,
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const ACCOUNT_TAG = /^[0-9a-f]{32}$/;

const LINES: readonly CostLine[] = [
  "d1_rows_written",
  "r2_class_a",
  "browser_rendering_seconds",
];

const R2_CLASS_A: ReadonlySet<string> = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

const R2_NOT_CLASS_A: ReadonlySet<string> = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
  "DeleteObject",
  "DeleteBucket",
  "AbortMultipartUpload",
]);

function fail(message: string): never {
  throw new Error(`cost-guard: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previousUtcDay(now: Date): string {
  const startOfUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = new Date(startOfUtcDay - 86_400_000).toISOString().slice(0, 10);
  if (!DAY.test(day)) fail(`computed day ${day} is not YYYY-MM-DD`);
  return day;
}

function requireDay(day: string): string {
  if (!DAY.test(day)) fail(`day ${day} is not YYYY-MM-DD`);
  return day;
}

function readNumber(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${where} ${key} is not a non-negative number`);
  }
  return value;
}

function groupsOf(account: Record<string, unknown>, key: "d1" | "r2" | "browser"): unknown[] {
  const groups = account[key];
  if (!Array.isArray(groups)) fail(`${key} is missing`);
  if (groups.length >= GROUP_LIMIT[key]) {
    fail(`${key} returned ${String(groups.length)} groups, a full page; refusing to under-count`);
  }
  return groups;
}

function sumNamedGroups(
  groups: unknown[],
  day: string,
  metric: "rowsWritten" | "totalSessionDurationMs",
  where: "d1" | "browser",
): number {
  let total = 0;
  for (const group of groups) {
    if (!isRecord(group) || !isRecord(group.dimensions) || !isRecord(group.sum)) {
      fail(`${where} group is missing dimensions or sum`);
    }
    const date = group.dimensions.date;
    if (typeof date !== "string" || date !== day) {
      fail(`${where} group date does not match ${day}`);
    }
    total += readNumber(group.sum, metric, where);
  }
  return total;
}

function classARequests(groups: unknown[]): number {
  let total = 0;
  for (const group of groups) {
    if (!isRecord(group) || !isRecord(group.dimensions) || !isRecord(group.sum)) {
      fail("r2 group is missing dimensions or sum");
    }
    const action = group.dimensions.actionType;
    if (typeof action !== "string" || action.length === 0) fail("r2 actionType is missing");
    const requests = readNumber(group.sum, "requests", action);
    if (R2_CLASS_A.has(action)) {
      total += requests;
    } else if (!R2_NOT_CLASS_A.has(action)) {
      fail(`unrecognized R2 actionType ${action}`);
    }
  }
  return total;
}

export function readCostTotals(graphql: unknown, day: string): CostTotals {
  if (!isRecord(graphql)) fail("graphql body is not an object");
  if (graphql.errors != null) {
    if (!Array.isArray(graphql.errors) || graphql.errors.length > 0) {
      fail("graphql returned errors");
    }
  }
  if (!isRecord(graphql.data) || !isRecord(graphql.data.viewer)) fail("graphql data.viewer is missing");
  const accounts = graphql.data.viewer.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1 || !isRecord(accounts[0])) {
    fail("graphql accounts must be exactly one account");
  }
  const account = accounts[0];
  const rowsWritten = sumNamedGroups(groupsOf(account, "d1"), day, "rowsWritten", "d1");
  const durationMs = sumNamedGroups(
    groupsOf(account, "browser"),
    day,
    "totalSessionDurationMs",
    "browser",
  );
  return {
    d1_rows_written: rowsWritten,
    r2_class_a: classARequests(groupsOf(account, "r2")),
    browser_rendering_seconds: durationMs / 1000,
  };
}

function expectedFigures(override: Partial<CostTotals> | undefined): CostTotals {
  const base: CostTotals = { ...DOCUMENTED_PER_BRAND_PER_DAY };
  if (override === undefined) return base;
  const picked: Partial<CostTotals> = {};
  for (const line of LINES) {
    const value = override[line];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      fail(`expected ${line} is not a non-negative number`);
    }
    picked[line] = value;
  }
  return { ...base, ...picked };
}

function costQuery(accountId: string, day: string): string {
  return `query {
  viewer {
    accounts(filter: { accountTag: "${accountId}" }) {
      d1: d1AnalyticsAdaptiveGroups(limit: ${String(GROUP_LIMIT.d1)}, filter: { date_geq: "${day}", date_leq: "${day}" }) {
        dimensions { date }
        sum { rowsWritten }
      }
      r2: r2OperationsAdaptiveGroups(limit: ${String(GROUP_LIMIT.r2)}, filter: { date_geq: "${day}", date_leq: "${day}" }) {
        dimensions { actionType }
        sum { requests }
      }
      browser: browserRenderingBrowserTimeUsageAdaptiveGroups(limit: ${String(GROUP_LIMIT.browser)}, filter: { date_geq: "${day}", date_leq: "${day}" }) {
        dimensions { date }
        sum { totalSessionDurationMs }
      }
    }
  }
}`;
}

async function fetchGraphql(
  accountId: string,
  apiToken: string,
  day: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  if (!ACCOUNT_TAG.test(accountId)) fail("account id is not a 32-character hex tag");
  if (apiToken.length === 0) fail("api token is empty");
  const response = await fetchImpl(GRAPHQL_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: costQuery(accountId, day) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail(`graphql http ${String(response.status)}`);
  const body: unknown = await response.json();
  return body;
}

function perBrand(totals: CostTotals, onBrands: number): CostTotals {
  return {
    d1_rows_written: totals.d1_rows_written / onBrands,
    r2_class_a: totals.r2_class_a / onBrands,
    browser_rendering_seconds: totals.browser_rendering_seconds / onBrands,
  };
}

export async function checkCostRegression(input: CostGuardInput): Promise<CostGuardResult> {
  if (!Number.isInteger(input.onBrands) || input.onBrands < 1) {
    fail(`ON brand count must be a positive integer, got ${String(input.onBrands)}`);
  }
  const day = requireDay(input.day ?? previousUtcDay(input.now ?? new Date()));
  const graphql =
    input.graphql ??
    (await fetchGraphql(
      input.accountId ?? "",
      input.apiToken ?? "",
      day,
      input.fetchImpl ?? fetch,
    ));
  const totals = readCostTotals(graphql, day);
  const measured = perBrand(totals, input.onBrands);
  const expected = expectedFigures(input.expectedPerBrandPerDay);
  let alerts: CostAlert[] = [];
  for (const line of LINES) {
    if (measured[line] <= expected[line] * COST_REGRESSION_MULTIPLE) continue;
    const row: CostAlert = {
      id: `cost-guard:${day}:${line}`,
      line,
      measured: measured[line],
      expected: expected[line],
      day,
      total: totals[line],
      onBrands: input.onBrands,
    };
    const written = await Promise.resolve(input.writeAlert(row));
    if (written.id.length === 0) fail(`alert writer returned an empty id for ${line}`);
    alerts = [...alerts, { ...row, id: written.id }];
  }
  return { day, onBrands: input.onBrands, totals, perBrand: measured, expected, alerts };
}
