import { describe, expect, it } from "vitest";

import { classifyLanguage } from "~/lib/language-classifier";

describe("classifyLanguage", () => {
  it("classifies strong Devanagari copy as Hindi", () => {
    const result = classifyLanguage({
      previewHeadline: "सिर्फ आज के लिए ऑफर",
      body: "घर बैठे खरीदें और अभी ऑर्डर करें",
    });

    expect(result.label).toBe("Hindi");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.metadata.decisionReason).toBe("devanagari_dominant");
  });

  it("classifies romanized Hindi ad copy as Hinglish", () => {
    const result = classifyLanguage({
      previewHeadline: "Bass bhi. Battery bhi.",
      body: "Sirf aaj ke liye launch price. Abhi lelo.",
    });

    expect(result.label).toBe("Hinglish");
    expect(result.confidence).toBeGreaterThan(0.65);
    expect(result.metadata.cueMatches).toEqual(
      expect.arrayContaining(["bhi", "sirf", "abhi", "lelo"]),
    );
  });

  it("classifies clear English copy as English", () => {
    const result = classifyLanguage({
      previewHeadline: "Festive glow, without the guesswork.",
      body: "Up to 50% off with free shipping this weekend only.",
    });

    expect(result.label).toBe("English");
    expect(result.confidence).toBeGreaterThan(0.65);
  });

  it("uses Global for Arabic script copy", () => {
    const result = classifyLanguage({
      previewHeadline: "عرض اليوم فقط",
      body: "اشتر الآن واحصل على خصم كبير على كل المنتجات",
    });

    expect(result.label).toBe("Global");
    expect(result.metadata.decisionReason).toBe("global_script_detected");
  });

  it("uses Global for Japanese script copy", () => {
    const result = classifyLanguage({
      previewHeadline: "本日限定セール",
      body: "今すぐ購入して大きな割引をゲットしよう",
    });

    expect(result.label).toBe("Global");
    expect(result.metadata.decisionReason).toBe("global_script_detected");
  });

  it("uses Global for Cyrillic script copy", () => {
    const result = classifyLanguage({
      previewHeadline: "Скидка только сегодня",
      body: "Купите сейчас и получите бесплатную доставку по всей стране",
    });

    expect(result.label).toBe("Global");
    expect(result.metadata.decisionReason).toBe("global_script_detected");
  });

  it("uses Regional for non-Devanagari Indic script", () => {
    const result = classifyLanguage({
      previewHeadline: "আজই অর্ডার করুন",
      body: "নতুন অফার এখনই দেখুন",
    });

    expect(result.label).toBe("Regional");
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.metadata.decisionReason).toBe("regional_script_detected");
  });

  it("uses Unknown for tiny low-signal samples", () => {
    const result = classifyLanguage({
      previewHeadline: "Wow",
      body: "Sale",
    });

    expect(result.label).toBe("Unknown");
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.metadata.decisionReason).toBe("insufficient_signal");
  });
});
