export const SAMPLE_FIELD_UNAVAILABLE = "Not available in this sample";

// Every proof field on the public sample brief renders through this guard so a
// missing fixture value shows an explicit unavailable state instead of a blank
// definition. The live product never runs this path: authenticated briefs come
// from saved evidence, not from the sample fixture.
export function sampleField(value: string | null | undefined): string {
  return value && value.trim() ? value : SAMPLE_FIELD_UNAVAILABLE;
}

export const demoProof = {
  generatedAt: "sample",
  status: "sample_only",
  competitor: {
    name: "Nykaa",
    website: "nykaa.com",
    market: "India beauty retail",
  },
  summary: "Sample competitor evidence trail for a buyer evaluating Five to Nine.",
  trackedPreview: {
    watchlistName: "Nykaa weekly competitor watch",
    cadence: "Weekly digest",
    savedCompetitor: "nykaa.com",
    proofCount: 3,
    deliveryPreview: "Email digest with a markdown export preview",
    loop: [
      "Run the public search preview",
      "Create an account to save the competitor",
      "Receive the change brief with sources attached",
    ],
  },
  proofTrail: [
    {
      signal: "Offer text changed",
      evidence: "Hero copy changed from sale-led messaging to a routine-first bundle.",
      source: "Landing-page snapshot",
      age: "sample",
    },
    {
      signal: "CTA changed",
      evidence: "Primary action moved from Shop now to Build your routine.",
      source: "Page text capture",
      age: "sample",
    },
    {
      signal: "Ad hook repeated",
      evidence: "Three active Meta creatives repeat the same routine-first hook.",
      source: "Meta Ad Library capture",
      age: "sample",
    },
  ],
  digestPreview: {
    subject: "Nykaa changed the routine bundle angle",
    whatChanged: "Nykaa moved the pricing page from a sale-led hero to a routine-first bundle.",
    whyItMatters: "The page now sells a bundle habit, not a one-off discount, so your counter-offer should be reviewed before the next campaign refresh.",
    priority: "Review before next campaign refresh",
    recommendedMove: "Compare the bundle angle against your own acquisition offer and brief one counter-test.",
    confidence: "Verified evidence with source and freshness attached.",
    proofStatus: "Verified evidence",
    source: "Landing-page snapshot + page text capture",
    freshness: "Sample captured at 05:09",
  },
  reportPreview: {
    title: "Client report preview",
    rows: [
      "What changed: offer text and CTA",
      "Source trail: screenshot, page text, original link",
      "Next action: save to collection or share report",
    ],
  },
  insightPreview: {
    topHooks: ["Routine-first bundle", "Dermat approved", "Sale ending soon"],
    mediaMix: [
      { channel: "Website page", share: "70%", status: "live in current product" },
      { channel: "Public ad library", share: "30%", status: "live in current product" },
    ],
    creativeTimeline: [
      "Hook repeated across sample creatives",
      "Landing-page CTA changed",
      "Digest preview generated",
    ],
    landingPageHistory: [
      "Offer headline changed",
      "Primary CTA changed",
      "Lead form stayed absent",
    ],
  },
  exports: {
    digestMarkdown:
      "*Nykaa changed the routine bundle angle*\nPriority: Review before next campaign refresh\nSources: Landing-page snapshot, page text capture, Meta Ad Library capture",
    apiPath: "/api/demo-proof",
  },
} as const;
