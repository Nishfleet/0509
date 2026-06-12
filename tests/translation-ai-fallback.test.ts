import { describe, expect, it, vi } from "vitest";

import {
  LANGUAGE_DETECT_MODEL,
  TRANSLATION_MODEL,
  hasAmbiguousLatinSignals,
  translateAdText,
} from "~/lib/translation.server";

function buildAd(overrides: Record<string, unknown> = {}) {
  return {
    analysisFields: [],
    body: "Compra ahora con envío incluido",
    bodySecondary: undefined,
    creativeText: undefined,
    languageLabel: "English",
    previewHeadline: "Oferta única",
    previewSubhead: "",
    ...overrides,
  } as Parameters<typeof translateAdText>[1];
}

function buildEnv(responses: Record<string, unknown>) {
  const run = vi.fn(async (model: string) => responses[model]);
  return { env: { AI: { run } } as never, run };
}

describe("translateAdText AI language fallback", () => {
  it("detects and translates an ambiguous English-labeled foreign ad", async () => {
    const { env, run } = buildEnv({
      [LANGUAGE_DETECT_MODEL]: { response: "es" },
      [TRANSLATION_MODEL]: { translated_text: "Buy now with shipping included" },
    });

    const result = await translateAdText(env, buildAd());

    expect(result?.text).toBe("Buy now with shipping included");
    expect(result?.metadata.sourceLanguageCode).toBe("es");
    expect(result?.metadata.languageDetectionModel).toBe(LANGUAGE_DETECT_MODEL);
    expect(run).toHaveBeenCalledWith(
      TRANSLATION_MODEL,
      expect.objectContaining({ source_lang: "es" }),
    );
  });

  it("returns null when detection says the ad really is English", async () => {
    const { env, run } = buildEnv({ [LANGUAGE_DETECT_MODEL]: { response: "en" } });

    const result = await translateAdText(
      env,
      buildAd({ body: "Crisp mornings ahead", previewHeadline: "Layer up" }),
    );

    expect(result).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never calls detection for short copy with obvious English words", async () => {
    const { env, run } = buildEnv({});

    const result = await translateAdText(
      env,
      buildAd({ body: "Shop the sale", previewHeadline: "Save now" }),
    );

    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("skips detection entirely for long unambiguous English copy", async () => {
    const { env, run } = buildEnv({});
    const longEnglish =
      "Shop the brand new collection this weekend and save more on every single order with our biggest seasonal sale of the year so far";

    const result = await translateAdText(
      env,
      buildAd({ body: longEnglish, previewHeadline: "Weekend savings are here for everyone" }),
    );

    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("flags diacritics and short copy as ambiguous", () => {
    expect(hasAmbiguousLatinSignals("Envío grátis için")).toBe(true);
    expect(hasAmbiguousLatinSignals("Beli sekarang")).toBe(true);
    expect(hasAmbiguousLatinSignals("Shop the sale")).toBe(false);
    expect(
      hasAmbiguousLatinSignals(
        "A long plain English sentence with no accents that comfortably exceeds the short sample threshold for ambiguity checks",
      ),
    ).toBe(false);
  });
});
