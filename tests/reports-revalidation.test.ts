import { describe, expect, it } from "vitest";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import {
  isReportValidationOnlyFailure,
  shouldRevalidate,
} from "~/routes/app.reports";

function buildArgs(
  overrides: Partial<ShouldRevalidateFunctionArgs> = {},
): ShouldRevalidateFunctionArgs {
  return {
    actionResult: undefined,
    currentParams: {},
    currentUrl: new URL(
      "https://0509.io/app/reports/watchlist:e2e-watchlist-agency-1",
    ),
    defaultShouldRevalidate: true,
    formAction: undefined,
    formData: undefined,
    formEncType: undefined,
    formMethod: "POST",
    json: undefined,
    nextParams: {},
    nextUrl: new URL(
      "https://0509.io/app/reports/watchlist:e2e-watchlist-agency-1",
    ),
    text: undefined,
    ...overrides,
  } as ShouldRevalidateFunctionArgs;
}

describe("reports route revalidation", () => {
  it("classifies review_required / plan_gated / evidence_not_ready as validation-only", () => {
    expect(
      isReportValidationOnlyFailure({
        ok: false,
        error: "review_required",
        intent: "share-report",
      }),
    ).toBe(true);
    expect(
      isReportValidationOnlyFailure({
        ok: false,
        error: "plan_gated",
        intent: "download-pdf",
      }),
    ).toBe(true);
    expect(
      isReportValidationOnlyFailure({
        ok: false,
        error: "evidence_not_ready",
        intent: "share-report",
      }),
    ).toBe(true);
  });

  it("does not treat review_stale or success as validation-only", () => {
    expect(
      isReportValidationOnlyFailure({
        ok: false,
        error: "review_stale",
        intent: "share-report",
      }),
    ).toBe(false);
    expect(
      isReportValidationOnlyFailure({
        ok: true,
        intent: "share-report",
        message: "Snapshot link created.",
      }),
    ).toBe(false);
    expect(isReportValidationOnlyFailure(null)).toBe(false);
  });

  it("skips loader revalidation after validation-only share failures", () => {
    expect(
      shouldRevalidate(
        buildArgs({
          actionResult: {
            ok: false,
            error: "review_required",
            intent: "share-report",
            message:
              "Review the current evidence before sharing or downloading this report.",
          },
        }),
      ),
    ).toBe(false);
  });

  it("revalidates after review_stale so the open form gets the current fingerprint", () => {
    expect(
      shouldRevalidate(
        buildArgs({
          actionResult: {
            ok: false,
            error: "review_stale",
            intent: "share-report",
            message:
              "The report changed after you opened it. Review the current evidence before sharing or downloading.",
          },
        }),
      ),
    ).toBe(true);
  });

  it("revalidates after a successful share", () => {
    expect(
      shouldRevalidate(
        buildArgs({
          actionResult: {
            ok: true,
            intent: "share-report",
            message: "Snapshot link created.",
            shareUrl: "https://0509.io/share/token",
          },
        }),
      ),
    ).toBe(true);
  });

  it("keeps the default decision when there is no action result", () => {
    expect(
      shouldRevalidate(
        buildArgs({
          actionResult: undefined,
          defaultShouldRevalidate: true,
          formMethod: undefined,
        }),
      ),
    ).toBe(true);
    expect(
      shouldRevalidate(
        buildArgs({
          actionResult: undefined,
          defaultShouldRevalidate: false,
          formMethod: undefined,
        }),
      ),
    ).toBe(false);
  });
});
