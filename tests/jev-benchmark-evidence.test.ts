import { describe, expect, it } from 'vitest';
import evidence from '../docs/benchmarks/jev-ads-2026-09.json';
import mentions from '../docs/benchmarks/jev-mentions-2026-09.json';

const questions = ['format', 'offer_type', 'hook', 'funnel_stage', 'is_new_campaign'] as const;

describe('3531 real benchmark evidence', () => {
  it('keeps real IDs, hashes, quarters, nulls and the achieved denominator', () => {
    expect(evidence.rows).toHaveLength(132);
    expect(new Set(evidence.rows.map(row => row.id)).size).toBe(132);
    for (const quarter of [1, 2, 3, 4]) {
      expect(evidence.rows.filter(row => row.cohort_quarter === quarter)).toHaveLength(33);
    }
    for (const row of evidence.rows) {
      expect(row.id).toMatch(/^\d+$/);
      expect(row.prior_id).not.toBe(row.id);
      expect(row.source_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.state_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Number.isFinite(Date.parse(row.evaluated_at))).toBe(true);
    }
    expect(mentions.rows).toHaveLength(112);
    expect(new Set(mentions.rows.map(row => row.id)).size).toBe(112);
    expect(mentions.status).toContain('not evaluated');
  });

  for (const question of questions) {
    it(`recomputes ${question} accuracy, calibration and independent disagreement`, () => {
      const metric = evidence.metrics[question];
      const samples = evidence.rows.flatMap(row => {
        const truth = row.labels[question];
        if (truth === null) return [];
        const answer = row.answers[question];
        if ('probability' in answer) {
          const p = answer.probability;
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          return [{ confidence: Math.max(p, 1 - p), hit: Number((p >= .5) === truth), brier: (p - Number(truth)) ** 2 }];
        }
        const probabilities = Object.entries(answer.probabilities);
        for (const [, p] of probabilities) {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
        expect(probabilities.reduce((sum, [, p]) => sum + p, 0)).toBeCloseTo(1, 1);
        const confidence = probabilities.find(([label]) => label === answer.choice)?.[1];
        if (confidence === undefined) throw new Error('Missing chosen probability');
        return [{ confidence, hit: Number(answer.choice === truth), brier: probabilities.reduce((sum, [label, p]) => sum + (p - Number(label === truth)) ** 2, 0) }];
      });
      expect(samples).toHaveLength(metric.n);
      expect(132 - samples.length).toBe(metric.null_labels);
      expect(samples.reduce((sum, row) => sum + row.hit, 0)).toBe(metric.correct);
      expect(metric.correct / metric.n).toBeCloseTo(metric.accuracy, 10);
      expect(samples.reduce((sum, row) => sum + row.brier, 0) / samples.length).toBeCloseTo(metric.brier, 10);
      let ece = 0;
      let count = 0;
      for (const bin of metric.calibration_bins) {
        const rows = samples.filter(row => Math.min(9, Math.floor(row.confidence * 10)) === Math.round(bin.lower * 10));
        expect(rows).toHaveLength(bin.n);
        const confidence = rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length;
        const accuracy = rows.reduce((sum, row) => sum + row.hit, 0) / rows.length;
        expect(confidence).toBeCloseTo(bin.mean_confidence, 10);
        expect(accuracy).toBeCloseTo(bin.accuracy, 10);
        ece += rows.length * Math.abs(confidence - accuracy);
        count += rows.length;
      }
      expect(count).toBe(samples.length);
      expect(ece / count).toBeCloseTo(metric.ece, 10);
      const audit = evidence.rows.filter(row => row.audit_labels !== null);
      expect(audit).toHaveLength(30);
      expect(audit.filter(row => row.audit_labels?.[question] !== row.labels[question])).toHaveLength(metric.audit_disagreements);
    });
  }

  it('pins the evidence to the scoring script that produced it', async () => {
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    const scorerPath = new URL('../scripts/bench/jev-score-ads-2026-09.mjs', import.meta.url);
    const scorerSha256 = createHash('sha256').update(await readFile(scorerPath)).digest('hex');
    expect(evidence.scoring_source_sha256).toBe(scorerSha256);
    expect(evidence.notes.join(' ')).toContain('leakage');
    expect(String(evidence.summary.scored)).toBe('132');
  });

  it('recomputes measured token cost and nearest-rank latency', () => {
    const tokens = evidence.rows.reduce((sum, row) => sum + row.input_tokens, 0);
    expect(tokens).toBe(evidence.summary.input_tokens);
    expect(tokens * .042 / 1e6).toBeCloseTo(evidence.summary.estimated_usd, 10);
    expect(evidence.summary.estimated_usd).toBeLessThan(1);
    const latency = evidence.rows.map(row => row.latency_ms).sort((a, b) => a - b);
    expect(latency[Math.ceil(latency.length * .5) - 1]).toBe(evidence.summary.latency_p50_ms);
    expect(latency[Math.ceil(latency.length * .95) - 1]).toBe(evidence.summary.latency_p95_ms);
  });
});
