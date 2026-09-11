import { describe, expect, it } from "vitest";

import {
  KNOWN_NO_COVERAGE,
  REQUEST_ERROR_RETRY_LIMIT,
  evaluateSneakerResaleRecall,
  probeSneakerResaleDomain,
} from "../scripts/canary-sneaker-resale-recall.mjs";

/**
 * Issue #2700: a single transport blip (fetch throw / 5xx) used to fail the
 * whole 25-domain sweep — finishline.com and jdsports.com each returned
 * one-off ERRs that failed otherwise-green runs. The probe now retries the
 * transient class a bounded number of times; a persistent failure still
 * reports requestError and fails loud ("cannot confirm" is never a pass).
 */

const NO_SLEEP = () => Promise.resolve();

function htmlWithVerifiedRows(count: number): string {
  const rows = Array.from(
    { length: count },
    () => `<div class="f9-wk-row"><span class="f9-tier-badge is-verified"></span></div>`,
  ).join("");
  return `<html><body><h2 class="f9-wk-sec-title">${count} verified ads linked to example.com</h2>${rows}</body></html>`;
}

function okResponse(html: string): Response {
  return new Response(html, { status: 200 });
}

describe("probeSneakerResaleDomain transport-error retry", () => {
  it("retries a thrown fetch once and reports the recovered page", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("socket hang up");
      }
      return okResponse(htmlWithVerifiedRows(3));
    }) as typeof fetch;

    const probe = await probeSneakerResaleDomain({
      domain: "example.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      sleepImpl: NO_SLEEP,
    });

    expect(calls).toBe(2);
    expect(probe.status).toBe(200);
    expect(probe.rowCount).toBe(3);
    expect(probe.tierCounts.verified).toBe(3);
    expect(probe.requestError).toBeUndefined();
  });

  it("still fails loud when the transport error persists past the retry budget", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error("timeout");
    }) as typeof fetch;

    const probe = await probeSneakerResaleDomain({
      domain: "example.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      sleepImpl: NO_SLEEP,
    });

    expect(calls).toBe(REQUEST_ERROR_RETRY_LIMIT + 1);
    expect(probe.status).toBeNull();
    expect(probe.requestError).toBe("timeout");
    const verdict = evaluateSneakerResaleRecall([probe]);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((p) => p.domain)).toEqual(["example.com"]);
  });

  it("retries a 5xx and reports the recovered page", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("edge error", { status: 503 })
        : okResponse(htmlWithVerifiedRows(2));
    }) as typeof fetch;

    const probe = await probeSneakerResaleDomain({
      domain: "example.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      sleepImpl: NO_SLEEP,
    });

    expect(calls).toBe(2);
    expect(probe.status).toBe(200);
    expect(probe.tierCounts.verified).toBe(2);
    expect(probe.requestError).toBeUndefined();
  });

  it("reports requestError when a 5xx persists past the retry budget", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("edge error", { status: 503 });
    }) as typeof fetch;

    const probe = await probeSneakerResaleDomain({
      domain: "example.com",
      baseUrl: "https://0509.io",
      fetchImpl,
      sleepImpl: NO_SLEEP,
    });

    expect(calls).toBe(REQUEST_ERROR_RETRY_LIMIT + 1);
    expect(probe.status).toBe(503);
    expect(probe.requestError).toBe("HTTP 503");
    expect(evaluateSneakerResaleRecall([probe]).pass).toBe(false);
  });
});

describe("evaluateSneakerResaleRecall cannot-confirm contract", () => {
  const base = {
    brand: "brand",
    rowCount: 0,
    tierCounts: { verified: 0, likely: 0, unmatched: 0 },
    headline: null,
    isWarming: false,
  };

  it("fails a no-coverage carve-out domain whose probe could not confirm", () => {
    const domain = [...KNOWN_NO_COVERAGE][0];
    const verdict = evaluateSneakerResaleRecall([
      { ...base, domain, status: null, requestError: "timeout" },
    ]);
    expect(verdict.pass).toBe(false);
    expect(verdict.noCoverage).toHaveLength(0);
    expect(verdict.failures.map((p) => p.domain)).toEqual([domain]);
  });

  it("still passes a no-coverage carve-out domain on a confirmed settled page", () => {
    const domain = [...KNOWN_NO_COVERAGE][0];
    const verdict = evaluateSneakerResaleRecall([
      { ...base, domain, status: 200 },
    ]);
    expect(verdict.pass).toBe(true);
    expect(verdict.noCoverage.map((p) => p.domain)).toEqual([domain]);
  });
});
