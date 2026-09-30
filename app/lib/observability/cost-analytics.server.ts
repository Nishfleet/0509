import { fetchOutbound } from "../fetch/outbound.server";
import type { CloudflareUsage } from "./cost-guard";

export const ACCOUNT_TAG = "f670a698e17bf160c8e4679823e68916";

export const D1_DATABASE_ID = "746c6e3d-782e-443a-82d6-28ca93a16294";

export const SNAPSHOT_BUCKET = "0509-snapshots";

export const R2_CLASS_A_ACTIONS: readonly string[] = [
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
  "LifecycleStorageTierTransition",
];

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const GROUP_LIMIT = 10000;

export const USAGE_QUERY = `query ($accountTag: string!, $databaseId: string!, $bucket: string!, $date: Date!, $actions: [string!]!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1: d1AnalyticsAdaptiveGroups(limit: ${String(GROUP_LIMIT)}, filter: { date: $date, databaseId: $databaseId }) {
        sum { rowsWritten }
      }
      r2: r2OperationsAdaptiveGroups(limit: ${String(GROUP_LIMIT)}, filter: { date: $date, bucketName: $bucket, actionType_in: $actions }) {
        sum { requests }
      }
    }
  }
}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function throwIfGraphqlErrors(body: unknown): void {
  if (!isRecord(body)) return;
  const errors = body.errors;
  if (errors === undefined || errors === null) return;
  if (!isUnknownArray(errors)) throw new Error("cloudflare graphql: errors is not an array");
  if (errors.length === 0) return;
  const first = errors[0];
  if (!isRecord(first) || typeof first.message !== "string") {
    throw new Error("cloudflare graphql: missing error message");
  }
  throw new Error("cloudflare graphql: " + first.message);
}

function firstAccount(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body)) return null;
  const data = body.data;
  if (!isRecord(data)) return null;
  const viewer = data.viewer;
  if (!isRecord(viewer)) return null;
  const accounts = viewer.accounts;
  if (!isUnknownArray(accounts)) return null;
  const account = accounts[0];
  if (!isRecord(account)) return null;
  return account;
}

function sumRows(rows: unknown, alias: string, field: string): number {
  if (!isUnknownArray(rows)) throw new Error("cloudflare graphql: " + alias + " is not an array");
  if (rows.length >= GROUP_LIMIT) throw new Error("cloudflare graphql: " + alias + " hit group limit");
  let total = 0;
  for (const row of rows) {
    if (!isRecord(row) || !isRecord(row.sum)) {
      throw new Error("cloudflare graphql: " + alias + " row has no sum");
    }
    const value = row.sum[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("cloudflare graphql: " + alias + " " + field + " is not a number");
    }
    total += value;
  }
  return total;
}

export function parseUsageResponse(day: string, body: unknown): CloudflareUsage {
  throwIfGraphqlErrors(body);
  const account = firstAccount(body);
  if (account === null) throw new Error("cloudflare graphql: missing account");
  return {
    day,
    d1RowsWritten: sumRows(account.d1, "d1", "rowsWritten"),
    r2ClassAOps: sumRows(account.r2, "r2", "requests"),
  };
}

export async function fetchDailyUsage(day: string, apiToken: string): Promise<CloudflareUsage> {
  const res = await fetchOutbound(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: USAGE_QUERY,
      variables: {
        accountTag: ACCOUNT_TAG,
        databaseId: D1_DATABASE_ID,
        bucket: SNAPSHOT_BUCKET,
        date: day,
        actions: R2_CLASS_A_ACTIONS,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("cloudflare graphql: HTTP " + String(res.status) + ": " + text);
  }
  const payload: unknown = await res.json();
  return parseUsageResponse(day, payload);
}
