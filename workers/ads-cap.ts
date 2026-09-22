export const PAGE_SWEEP_MAX_CONCURRENCY = 8;
export const RESERVED_INTERACTIVE_BROWSERS = 2;
export const BROWSER_CONCURRENCY_CAP = 10;
export const FETCH_SWEEP_MAX_CONCURRENCY = 20;
export const SWEEP_BATCH_LIMIT = 100;
export const ADS_SWEEP_CRON = "0 2 * * *";
export const PAGE_SWEEP_QUEUE = "page-sweep";
export const FETCH_SWEEP_QUEUE = "fetch-sweep";
export const PAGE_SWEEP_DLQ = "page-sweep-dlq";
export const FETCH_SWEEP_DLQ = "fetch-sweep-dlq";

export function assertBrowserCap(
  pageSweepMaxConcurrency: number,
  cap: number,
): void {
  if (pageSweepMaxConcurrency > PAGE_SWEEP_MAX_CONCURRENCY) {
    throw new Error(
      `page-sweep max_concurrency ${String(pageSweepMaxConcurrency)} is above ${String(PAGE_SWEEP_MAX_CONCURRENCY)}`,
    );
  }
  const total = pageSweepMaxConcurrency + RESERVED_INTERACTIVE_BROWSERS;
  if (total !== cap) {
    throw new Error(
      `page-sweep max_concurrency ${String(pageSweepMaxConcurrency)} + ${String(RESERVED_INTERACTIVE_BROWSERS)} reserved browsers = ${String(total)}, cap is ${String(cap)}`,
    );
  }
}
