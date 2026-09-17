#!/usr/bin/env node
// Score the saved ads corpus with Jev for the issue 3531 benchmark.
//
//   node scripts/bench/jev-score-ads-2026-09.mjs <corpus.json> <outdir>
//
// One jev-eval call per ad (5 questions bundled). Writes <outdir>/scores.jsonl
// (one JSON line per ad: id, answers, usage, ms, ref) plus a failures list.
// Requires the installed jev-eval helper on PATH (fleet-ops bin/jev-eval.mjs).
// Reads no labels: scoring must stay blind to the truth files.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const [corpusPath, outDir] = process.argv.slice(2);
if (!corpusPath || !outDir) {
  console.error("usage: node scripts/bench/jev-score-ads-2026-09.mjs <corpus.json> <outdir>");
  process.exit(2);
}

const rows = JSON.parse(readFileSync(corpusPath, "utf8"));
mkdirSync(outDir, { recursive: true });

const CHOICE = (type, criteria, instructions) => ({ type, criteria, instructions });
const OFFER = {
  discount: "price or percent off",
  free_shipping: "shipping cost waived",
  free_trial: "time-boxed free access",
  bundle: "multiple products for one price",
  giveaway: "prize, sweepstakes or free gift",
  none: "no explicit incentive",
  other: "any other explicit incentive",
};
const HOOK = {
  announcement: "news, launch, event or 'is back' statement",
  benefit: "what you get, lifestyle or aspiration",
  problem_solution: "pain point then remedy",
  social_proof: "creator, testimonial, community",
  urgency: "deadline, scarcity, act-now pressure",
  question: "opens with a genuine question",
  other: "anything else",
};

const QUESTIONS = {
  format: CHOICE("choice", { image: "static image", video: "video", unknown: "cannot tell from text" },
    "Predict the ad's stored format field from its copy alone. Media is NOT shown. If the text gives no signal (e.g. 'Watch more' or transcript-like copy), answer unknown."),
  offer_type: CHOICE("choice", OFFER,
    "Classify the dominant explicit incentive in this ad's copy. If there is no explicit incentive, answer none."),
  hook: CHOICE("choice", HOOK,
    "Classify the opening line of the ad (its hook). Judge only from the opening; a question counts only if the ad literally opens with a question."),
  funnel_stage: CHOICE("choice", { awareness: "brand or category building only", consideration: "research, compare, learn more", conversion: "direct buy, install, sign up or register now" },
    "Which funnel stage does this ad target? Judge from the call to action and the copy's intent."),
  is_new_campaign: { type: "boolean",
    instructions: "Is this a NEW campaign versus the prior creative from the same advertiser? true = different offer, product or message theme. false = same offer/theme with copy, format, locale, CTA or media tweaks. Judge from the two texts." },
};

function stateFor(row) {
  const c = row.record.creative;
  const p = row.prior?.creative ?? {};
  const clip = (s, n) => (s ? String(s).slice(0, n) : "");
  return {
    advertiser: c.advertiser,
    stored_format_hint: c.creativeFormatHint ?? c.format ?? null,
    language: c.languageLabel ?? null,
    ad_text: clip(c.creativeText || c.body, 1000),
    hook_field: clip(c.hook, 200),
    offer_field: clip(c.offer, 200),
    cta: clip(c.cta, 80),
    prior_ad_text: clip(p.creativeText || p.body, 400),
    prior_first_seen: p.firstSeenAt ?? null,
    days_after_prior: (() => {
      try {
        const d = (new Date(c.firstSeenAt) - new Date(p.firstSeenAt)) / 86400000;
        return Number.isFinite(d) ? Math.round(d) : null;
      } catch { return null; }
    })(),
  };
}

const scores = [];
const failures = [];
for (const row of rows) {
  const id = row.record.creative.metaAdId;
  const payload = JSON.stringify({
    state: stateFor(row),
    questions: QUESTIONS,
    site: "0509-3531-ads-score",
    ref: `Nishfleet/0509#3531:ad:${id}`,
  });
  try {
    const out = execFileSync("jev-eval", ["--site", "0509-3531-ads-score", "--ref", `Nishfleet/0509#3531:ad:${id}`],
      { input: payload, encoding: "utf8", timeout: 120000 });
    const parsed = JSON.parse(out);
    scores.push({ id, cohort_quarter: row.cohort_quarter, state_sha256: parsed.state_sha256, ms: parsed.ms, usage: parsed.usage, answers: parsed.answers });
    process.stdout.write(`ok ${id} ${parsed.ms}ms\n`);
  } catch (e) {
    failures.push({ id, error: `jev-eval failed; exit=${e.status ?? 'unknown'}` });
    process.stdout.write(`FAIL ${id}\n`);
  }
}

writeFileSync(`${outDir}/scores.jsonl`, scores.map((s) => JSON.stringify(s)).join("\n") + "\n");
writeFileSync(`${outDir}/score-failures.json`, JSON.stringify(failures, null, 1) + "\n");
const tokens = scores.reduce((a, s) => a + (s.usage?.inputTokens || 0), 0);
console.log(`scored=${scores.length} failed=${failures.length} inputTokens=${tokens}`);
if (failures.length) process.exitCode = 1;
