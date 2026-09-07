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

  it("classifies Spanish ad copy as Spanish", () => {
    const result = classifyLanguage({
      previewHeadline: "Solo hoy: envío gratis",
      body: "Compra ahora y consigue un descuento en toda la tienda",
    });

    expect(result.label).toBe("Spanish");
    expect(result.metadata.decisionReason).toBe("latin_language_cues");
  });

  it("classifies the Nike Spanish Ad Library miss as Spanish not Vietnamese", () => {
    const result = classifyLanguage({
      body: "Entra a Nike.com y encuentra actualizaciones semanales de producto con envío gratis.",
    });
    expect(result.label).toBe("Spanish");
  });

  it("classifies additional Romance ad sentences without Spanish/Portuguese/Italian mixups", () => {
    expect(
      classifyLanguage({
        body: "Descubre nuestra nueva colección y compra con envío gratis a todo el país.",
      }).label,
    ).toBe("Spanish");

    expect(
      classifyLanguage({
        body: "Compre agora com frete grátis e não perca a oferta da loja esta semana.",
      }).label,
    ).toBe("Portuguese");

    expect(
      classifyLanguage({
        body: "Acquista ora con spedizione gratuita e scopri la nuova offerta della settimana.",
      }).label,
    ).toBe("Italian");
  });

  it("classifies Portuguese ad copy as Portuguese", () => {
    const result = classifyLanguage({
      previewHeadline: "Frete grátis só hoje",
      body: "Compre agora com desconto e não perca a oferta da loja",
    });

    expect(result.label).toBe("Portuguese");
  });

  it("classifies French ad copy as French", () => {
    const result = classifyLanguage({
      previewHeadline: "Livraison gratuite pour vous",
      body: "Achetez maintenant et profitez de votre remise chez nous",
    });

    expect(result.label).toBe("French");
  });

  it("classifies German ad copy as German", () => {
    const result = classifyLanguage({
      previewHeadline: "Jetzt kaufen und sparen",
      body: "Kostenloser Versand heute — sichern Sie sich Ihre Rabatt-Angebot mit mehr Auswahl",
    });

    expect(result.label).toBe("German");
  });

  it("classifies Turkish ad copy as Turkish", () => {
    const result = classifyLanguage({
      previewHeadline: "Bugün için büyük indirim",
      body: "Şimdi satın alın, ücretsiz kargo fırsatını kaçırmayın",
    });

    expect(result.label).toBe("Turkish");
  });

  it("classifies Swahili ad copy as Swahili", () => {
    const result = classifyLanguage({
      previewHeadline: "Punguzo kubwa leo",
      body: "Nunua sasa kwa bei nzuri na pata ofa zaidi kila siku dukani",
    });

    expect(result.label).toBe("Swahili");
  });

  it("classifies Indonesian ad copy as Indonesian", () => {
    const result = classifyLanguage({
      previewHeadline: "Diskon besar hari ini",
      body: "Beli sekarang dengan gratis ongkir untuk semua promo belanja yang baru",
    });

    expect(result.label).toBe("Indonesian");
  });

  it("classifies Vietnamese ad copy as Vietnamese", () => {
    const result = classifyLanguage({
      previewHeadline: "Giảm giá hôm nay",
      body: "Mua ngay để nhận miễn phí vận chuyển cho mọi đơn hàng mới",
    });

    expect(result.label).toBe("Vietnamese");
  });

  it("keeps plain English copy as English despite shared words", () => {
    const result = classifyLanguage({
      previewHeadline: "Get free shipping this weekend",
      body: "Shop the new collection today and save more on every order",
    });

    expect(result.label).toBe("English");
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
