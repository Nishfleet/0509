export interface CostAlert {
  id: string;
  line: "d1_rows_written" | "r2_class_a" | "browser_rendering_seconds";
  measured: number;
  expected: number;
  day: string;
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
  expected: {
    d1_rows_written: number;
    r2_class_a: number;
    browser_rendering_seconds: number;
  };
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
}

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const DATABASE_ID = "746c6e3d-782e-443a-82d6-28ca93a16294";

const BUCKET_NAME = "0509-snapshots";

const ORDINARY_DAYS = 7;

const COST_REGRESSION_MULTIPLE = 3;

const D1_ROWS_WRITTEN_WEEK = 223_287;

const D1_ROWS_PER_BRAND_PER_DAY = 10;

const BROWSER_DURATION_WEEK_MS = 62_703_271;

const BROWSER_SECONDS_PER_BRAND_PER_DAY = 15;

const R2_CLASS_A_WEEK = 1;

const GROUP_LIMIT = {
  d1: 10,
  r2: 100,
  browser: 10,
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const ACCOUNT_TAG = /^[0-9a-f]{32}$/;

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

function requireDimensions(group: unknown, where: "d1" | "r2" | "browser"): {
  dimensions: Record<string, unknown>;
  sum: Record<string, unknown>;
} {
  if (!isRecord(group) || !isRecord(group.dimensions) || !isRecord(group.sum)) {
    fail(`${where} group is missing dimensions or sum`);
  }
  return { dimensions: group.dimensions, sum: group.sum };
}

function documentedDay(weekFloor: number, perBrandPerDay: number, onBrands: number): number {
  return weekFloor / ORDINARY_DAYS + perBrandPerDay * onBrands;
}

function exceedsTriple(measured: number, weekFloor: number, perBrandPerDay: number, onBrands: number): boolean {
  return (
    measured * ORDINARY_DAYS >
    COST_REGRESSION_MULTIPLE * (weekFloor + perBrandPerDay * onBrands * ORDINARY_DAYS)
  );
}

function sumD1Rows(groups: unknown[], day: string): number {
  return groups.reduce<number>((total, group) => {
    const { dimensions, sum } = requireDimensions(group, "d1");
    if (dimensions.date !== day) fail(`d1 group date does not match ${day}`);
    if (typeof dimensions.databaseId !== "string") fail("d1 group has no databaseId");
    if (dimensions.databaseId !== DATABASE_ID) fail("d1 group is not this database");
    return total + readNumber(sum, "rowsWritten", "d1");
  }, 0);
}

function sumClassA(groups: unknown[], day: string): number {
  return groups.reduce<number>((total, group) => {
    const { dimensions, sum } = requireDimensions(group, "r2");
    if (dimensions.date !== day) fail(`r2 group date does not match ${day}`);
    if (dimensions.bucketName !== BUCKET_NAME) fail("r2 group is not the product bucket");
    const action = dimensions.actionType;
    if (typeof action !== "string" || action.length === 0) fail("r2 actionType is missing");
    const requests = readNumber(sum, "requests", action);
    if (R2_CLASS_A.has(action)) return total + requests;
    if (R2_NOT_CLASS_A.has(action)) return total;
    fail(`unrecognized R2 actionType ${action}`);
  }, 0);
}

function sumBrowserMs(groups: unknown[], day: string): number {
  return groups.reduce<number>((total, group) => {
    const { dimensions, sum } = requireDimensions(group, "browser");
    if (dimensions.date !== day) fail(`browser group date does not match ${day}`);
    return total + readNumber(sum, "totalSessionDurationMs", "browser");
  }, 0);
}

function readScopedTotals(graphql: unknown, day: string): { totals: CostTotals; browserMs: number } {
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
  const browserMs = sumBrowserMs(groupsOf(account, "browser"), day);
  return {
    browserMs,
    totals: {
      d1_rows_written: sumD1Rows(groupsOf(account, "d1"), day),
      r2_class_a: sumClassA(groupsOf(account, "r2"), day),
      browser_rendering_seconds: browserMs / 1000,
    },
  };
}

function costQuery(accountId: string, day: string): string {
  return `query {
  viewer {
    accounts(filter: { accountTag: "${accountId}" }) {
      d1: d1AnalyticsAdaptiveGroups(limit: ${String(GROUP_LIMIT.d1)}, filter: { date_geq: "${day}", date_leq: "${day}", databaseId: "${DATABASE_ID}" }) {
        dimensions { date databaseId }
        sum { rowsWritten }
      }
      r2: r2OperationsAdaptiveGroups(limit: ${String(GROUP_LIMIT.r2)}, filter: { date_geq: "${day}", date_leq: "${day}", bucketName: "${BUCKET_NAME}" }) {
        dimensions { date actionType bucketName }
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
  return response.json();
}

function oneAlert(
  line: CostAlert["line"],
  measured: number,
  expected: number,
  tripped: boolean,
  day: string,
): CostAlert[] {
  if (!tripped) return [];
  return [{ id: `cost-guard:${day}:${line}`, line, measured, expected, day }];
}

export async function checkCostRegression(input: CostGuardInput): Promise<CostGuardResult> {
  if (!Number.isInteger(input.onBrands) || input.onBrands < 0) {
    fail(`ON brand count must be a non-negative integer, got ${String(input.onBrands)}`);
  }
  const day = requireDay(input.day ?? previousUtcDay(input.now ?? new Date()));
  const graphql =
    input.graphql ??
    (await fetchGraphql(input.accountId ?? "", input.apiToken ?? "", day, input.fetchImpl ?? fetch));
  const { totals, browserMs } = readScopedTotals(graphql, day);
  const expected = {
    d1_rows_written: documentedDay(D1_ROWS_WRITTEN_WEEK, D1_ROWS_PER_BRAND_PER_DAY, input.onBrands),
    r2_class_a: R2_CLASS_A_WEEK,
    browser_rendering_seconds: documentedDay(
      BROWSER_DURATION_WEEK_MS / 1000,
      BROWSER_SECONDS_PER_BRAND_PER_DAY,
      input.onBrands,
    ),
  };
  const alerts = [
    ...oneAlert(
      "d1_rows_written",
      totals.d1_rows_written,
      expected.d1_rows_written,
      exceedsTriple(totals.d1_rows_written, D1_ROWS_WRITTEN_WEEK, D1_ROWS_PER_BRAND_PER_DAY, input.onBrands),
      day,
    ),
    ...oneAlert(
      "r2_class_a",
      totals.r2_class_a,
      expected.r2_class_a,
      totals.r2_class_a > COST_REGRESSION_MULTIPLE * R2_CLASS_A_WEEK,
      day,
    ),
    ...oneAlert(
      "browser_rendering_seconds",
      totals.browser_rendering_seconds,
      expected.browser_rendering_seconds,
      exceedsTriple(
        browserMs,
        BROWSER_DURATION_WEEK_MS,
        BROWSER_SECONDS_PER_BRAND_PER_DAY * 1000,
        input.onBrands,
      ),
      day,
    ),
  ];
  return { day, onBrands: input.onBrands, totals, expected, alerts };
}
