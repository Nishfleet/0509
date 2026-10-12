/**
 * The exact texts extractPageText yields for the J8 fixture's healthy and soft
 * pages — the pin that keeps the fixture's break unmistakable (0509#7340): with
 * only the pricing section gone, the nightly D3s verdict swung 0.58 -> 0.173
 * because a tidy one-section removal reads as a deliberate redesign, while the
 * emptied page holds the alert band on every repeat. Plain string constants, so
 * both the fixture-site (workerd) and evals (node) vitest projects import them:
 * tests/integration/fixture-site.test.ts asserts the real worker's pages
 * extract to exactly these, and tests/evals/fixture-soft-break.eval.test.ts
 * judges the diff between them with the shipped question. The integration
 * assertions fail first on any change to the fixture's visible text, and both
 * sides regenerate together.
 */
export const FIXTURE_HEALTHY_TEXT =
  "Five to Nine &mdash; fixture Track every competitor move, in one weekly brief Pricing " +
  "Starter &mdash; ₹499 / month Pro &mdash; ₹1,299 / month Team &mdash; ₹2,499 / month Choose a plan and check out";

export const FIXTURE_SOFT_TEXT = "Five to Nine &mdash; fixture";
