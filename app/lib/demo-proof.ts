export const demoProof = {
  generatedAt: "sample",
  status: "sample_only",
  competitor: {
    name: "Nykaa",
    website: "nykaa.com",
    market: "India beauty retail",
  },
  summary: "Sample competitor proof trail for a buyer evaluating Five to Nine.",
  trackedPreview: {
    watchlistName: "Nykaa weekly competitor watch",
    cadence: "Weekly digest",
    savedCompetitor: "nykaa.com",
    proofCount: 3,
    deliveryPreview: "Email digest with a markdown export preview",
    loop: [
      "Run a public live search",
      "Create an account to save the competitor",
      "Receive the proof-backed digest preview",
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
    priority: "Review before next campaign refresh",
    recommendedMove: "Compare the bundle angle against your own acquisition offer and brief one counter-test.",
    confidence: "Medium sample confidence",
  },
  insightPreview: {
    topHooks: ["Routine-first bundle", "Dermat approved", "Sale ending soon"],
    mediaMix: [
      { channel: "Meta", share: "70%", status: "live in current product" },
      { channel: "Landing page", share: "30%", status: "live in current product" },
      { channel: "TikTok / Google / LinkedIn", share: "planned", status: "not live yet" },
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
      "*Nykaa changed the routine bundle angle*\nPriority: Review before next campaign refresh\nProof: Landing-page snapshot, page text capture, Meta Ad Library capture",
    apiPath: "/api/demo-proof",
  },
} as const;
