import { describe, expect, it } from "vitest";

import { classifyAdAngle } from "~/lib/angle-classifier";

describe("classifyAdAngle", () => {
  describe("discount_urgency", () => {
    it("classifies an English discount ad with stacked urgency cues", () => {
      const result = classifyAdAngle(
        "Summer sale ends soon — up to 50% off everything. Use code SUN20 at checkout. Free shipping on all orders.",
      );

      expect(result?.angle).toBe("discount_urgency");
      expect(result?.lowConfidence).toBe(false);
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["sale", "ends soon", "free shipping"]));
    });

    it("classifies a Spanish discount ad", () => {
      const result = classifyAdAngle(
        "Solo hoy: 30% de descuento en toda la tienda online. Envío gratis y última oportunidad para ahorrar.",
      );

      expect(result?.angle).toBe("discount_urgency");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["descuento", "solo hoy"]));
    });

    it("classifies a French soldes ad", () => {
      const result = classifyAdAngle(
        "Soldes d'été : -30% sur tout le site. Livraison gratuite et dernière chance !",
      );

      expect(result?.angle).toBe("discount_urgency");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["soldes", "livraison gratuite"]));
    });

    it("classifies a German Rabatt ad", () => {
      const result = classifyAdAngle(
        "Nur heute: 20% Rabatt auf alles. Kostenloser Versand und Gutschein sichern — jetzt sparen!",
      );

      expect(result?.angle).toBe("discount_urgency");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["rabatt", "nur heute"]));
    });

    it("classifies a Portuguese desconto ad", () => {
      const result = classifyAdAngle(
        "Só hoje: desconto em toda a loja com frete grátis. Aproveite o cupom antes que acabe.",
      );

      expect(result?.angle).toBe("discount_urgency");
    });

    it("is case-insensitive on shouty discount copy", () => {
      const result = classifyAdAngle("SALE ENDS SOON — LAST CHANCE TO SAVE 50% OFF");

      expect(result?.angle).toBe("discount_urgency");
    });
  });

  describe("social_proof", () => {
    it("classifies ratings-and-crowd copy as social proof", () => {
      const result = classifyAdAngle(
        "Rated 4.8 stars by 12,000 happy customers. The bestseller everyone’s talking about.",
      );

      expect(result?.angle).toBe("social_proof");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["bestseller", "12,000 happy customers"]));
    });

    it("classifies press-and-award copy as social proof", () => {
      const result = classifyAdAngle(
        "Loved by editors and featured in Vogue. Award-winning formula with over 5,000 reviews.",
      );

      expect(result?.angle).toBe("social_proof");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["loved by", "5,000 reviews"]));
    });

    it("counts star-glyph ratings as social proof evidence", () => {
      const result = classifyAdAngle("Join thousands of runners who trust us. Top rated on Trustpilot with ★★★★★.");

      expect(result?.angle).toBe("social_proof");
    });
  });

  describe("problem_solution", () => {
    it("classifies pain-first mattress copy", () => {
      const result = classifyAdAngle(
        "Tired of waking up sore? Say goodbye to restless nights — our mattress solves back pain. No more tossing and turning.",
      );

      expect(result?.angle).toBe("problem_solution");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["tired of", "say goodbye to", "no more"]));
    });

    it("catches the stop-X-ing pattern", () => {
      const result = classifyAdAngle(
        "Stop scrubbing your pans for hours. This coating fixes the sticky mess problem for good.",
      );

      expect(result?.angle).toBe("problem_solution");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["Stop scrubbing"]));
    });

    it("classifies French pain-frame copy", () => {
      const result = classifyAdAngle("Marre de repasser ? Dites adieu aux plis.");

      expect(result?.angle).toBe("problem_solution");
    });
  });

  describe("new_launch", () => {
    it("classifies an introducing/now-available ad", () => {
      const result = classifyAdAngle("Introducing the all-new Aria desk lamp — now available in three finishes.");

      expect(result?.angle).toBe("new_launch");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["introducing", "now available"]));
    });

    it("classifies a just-dropped limited edition ad", () => {
      const result = classifyAdAngle("Just dropped: the limited edition colorway. Meet the newest member of the family.");

      expect(result?.angle).toBe("new_launch");
    });

    it("classifies a Spanish lanzamiento ad", () => {
      const result = classifyAdAngle("Nuevo lanzamiento: la nueva colección ya disponible en nuestra tienda.");

      expect(result?.angle).toBe("new_launch");
    });

    it("classifies a French nouveau ad", () => {
      const result = classifyAdAngle(
        "Nouveau : notre nouvelle gamme est enfin disponible. Lancement officiel cette semaine.",
      );

      expect(result?.angle).toBe("new_launch");
    });

    it("classifies a German launch ad", () => {
      const result = classifyAdAngle("Endlich da: das neue Modell ist jetzt erhältlich.");

      expect(result?.angle).toBe("new_launch");
    });
  });

  describe("ugc_style", () => {
    it("classifies first-person testimony copy", () => {
      const result = classifyAdAngle(
        "I tried this serum for 30 days — my honest review. I was skeptical but now I'm obsessed with the glow.",
      );

      expect(result?.angle).toBe("ugc_style");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["i tried", "my honest"]));
    });

    it("classifies emoji-dense first-person copy without phrase cues", () => {
      const result = classifyAdAngle("okay this little gadget is everything 😍✨🔥 my desk has never looked better!!");

      expect(result?.angle).toBe("ugc_style");
      expect(result?.matchedCues).toContain("emoji-dense first-person");
    });

    it("classifies POV/ngl creator-voice copy", () => {
      const result = classifyAdAngle("POV: you finally found a planner you'll actually use. Ngl, I bought three.");

      expect(result?.angle).toBe("ugc_style");
    });
  });

  describe("brand_lifestyle fallback", () => {
    it("returns brand_lifestyle with the low-confidence marker for evocative pressure-free copy", () => {
      const result = classifyAdAngle(
        "Some mornings ask for nothing. Linen woven on the coast, made for the slow hours in between. Learn more.",
      );

      expect(result?.angle).toBe("brand_lifestyle");
      expect(result?.lowConfidence).toBe(true);
      expect(result?.matchedCues).toEqual([]);
    });

    it("tolerates a single stray cue in otherwise evocative copy", () => {
      const result = classifyAdAngle(
        "A new chapter in quiet craftsmanship. Cedar, canvas, and time — objects made to grow old with you.",
      );

      expect(result?.angle).toBe("brand_lifestyle");
      expect(result?.lowConfidence).toBe(true);
    });

    it("refuses the fallback when CTA pressure is present", () => {
      expect(
        classifyAdAngle(
          "Live the coastal life you deserve. Shop now for pieces made with care and intention every single day.",
        ),
      ).toBeNull();
    });

    it("refuses the fallback when percent claims are present without discount framing", () => {
      expect(
        classifyAdAngle("Made from 100% organic cotton, woven for everyday softness and calm all year."),
      ).toBeNull();
    });

    it("marks clear cue-driven angles as not low-confidence", () => {
      const result = classifyAdAngle("Flash sale: 40% off sitewide, ends tonight. Free shipping included.");

      expect(result?.angle).toBe("discount_urgency");
      expect(result?.lowConfidence).toBe(false);
    });
  });

  describe("honest nulls", () => {
    it("returns null for text under 20 characters", () => {
      expect(classifyAdAngle("50% off everything")).toBeNull();
    });

    it("returns null for empty and whitespace-only text", () => {
      expect(classifyAdAngle("")).toBeNull();
      expect(classifyAdAngle("   \n\t  ")).toBeNull();
    });

    it("returns null for short ambiguous copy with only weak scattered cues", () => {
      expect(classifyAdAngle("New deals on our latest arrivals for your home.")).toBeNull();
    });

    it("returns null when the top two angles are within the margin", () => {
      // discount (sale + free shipping + today only = 3) vs new_launch (introducing + new = 2)
      expect(classifyAdAngle("Introducing our new sale — free shipping today only.")).toBeNull();
    });

    it("returns null on an even angle tie", () => {
      // new_launch (new + new collection + introducing = 3) vs discount (sale + deals = 2)
      expect(classifyAdAngle("New sale on the new collection — introducing weekend deals.")).toBeNull();
    });

    it("does not match cues inside larger words", () => {
      // "newsletter" must not trigger "new"; "salesforce" must not trigger "sale".
      expect(classifyAdAngle("Our newsletter on salesforce tips.")).toBeNull();
    });
  });

  describe("real-world-ish full ad bodies", () => {
    it("classifies a full discount ad body", () => {
      const result = classifyAdAngle(
        "MEGA SALE IS LIVE 🔥 Get up to 60% off sitewide plus free shipping on orders over $49. " +
          "Use code MEGA60 at checkout. Offer ends tonight — don’t miss out! Shop Now",
      );

      expect(result?.angle).toBe("discount_urgency");
      expect(result?.matchedCues).toEqual(expect.arrayContaining(["ends tonight", "don't miss out"]));
    });

    it("classifies a full social-proof ad body", () => {
      const result = classifyAdAngle(
        "The probiotic 30,000+ women swear by. Rated 4.9 stars across 8,000 reviews and " +
          "recommended by leading gynecologists. See why it keeps selling out.",
      );

      expect(result?.angle).toBe("social_proof");
    });

    it("classifies a full UGC-style ad body", () => {
      const result = classifyAdAngle(
        "I've been using this for 3 weeks and I'm not gonna lie… my skin has never been this clear. " +
          "My honest take: 10/10, absolutely obsessed with it 🥹💧✨",
      );

      expect(result?.angle).toBe("ugc_style");
    });
  });
});
