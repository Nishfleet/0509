#!/usr/bin/env node
/**
 * Weekly offer-moves data post — dry-run printer (issue #2143).
 *
 * Reads stored public moves (the shape `loadWeeklyPublicMoves` returns —
 * see app/lib/weekly-public-moves.server.ts) from a JSON fixture and prints
 * the plain-text data post an operator can paste into the weekly
 * r/FacebookAds-style thread: counts of new ads, offer changes, and price
 * drops, then the top five moves with their public /ads and /timeline links
 * and capture timestamps. No marketing lines — the post states what moved,
 * where the public proof page is, and when it was captured.
 *
 * Hard limits, by design (the issue's must-not list):
 *   - reads ONLY the --fixture JSON file: never touches D1, never triggers
 *     live scraping, never calls a provider;
 *   - prints to stdout only: never posts anywhere (posting is owner
 *     question 4 — a human copies the text);
 *   - runs only when invoked by hand: no schedule, no cron wiring.
 *
 * Usage:
 *   node scripts/weekly-offer-moves-report.mjs --dry-run --fixture tests/fixtures/offer-moves.json
 *
 * --dry-run is required (there is no non-dry-run mode — nothing else exists
 * to do). Exit code 0 on success, 1 on usage/parse errors.
 */

import { readFileSync } from "node:fs";

const SITE_ORIGIN = "https://0509.io";
const TOP_MOVES_LIMIT = 5;

// Field labels — the literal strings from WEEKLY_MOVE_FIELD in
// app/lib/weekly-public-moves.server.ts (this script cannot import TS, so
// the vocabulary is duplicated here; the fixture and tests pin both sides).
const FIELD_NEW_ADS = "New ads";
const FIELD_OFFER_PRICE = "Offer / price";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = /^--([^=]+)=(.*)$/.exec(arg);
    if (equals) {
      args.set(equals[1], equals[2]);
      continue;
    }
    const flag = /^--(.+)$/.exec(arg);
    if (!flag) continue;
    const name = flag[1];
    // `--key value` form when the next token is not another flag.
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args.set(name, next);
      index += 1;
    } else {
      args.set(name, true);
    }
  }
  return args;
}

function fail(message) {
  process.stderr.write(`weekly-offer-moves-report: ${message}\n`);
  process.exit(1);
}

/** Absolute public URL for a stored path; absolute URLs pass through. */
function publicUrl(pathOrUrl) {
  if (typeof pathOrUrl !== "string" || !pathOrUrl) return null;
  if (pathOrUrl.startsWith("https://") || pathOrUrl.startsWith("http://")) {
    return pathOrUrl;
  }
  return pathOrUrl.startsWith("/") ? `${SITE_ORIGIN}${pathOrUrl}` : null;
}

/** First number in a price/offer string ("₹1,299" -> 1299), or null. */
function firstNumber(value) {
  if (typeof value !== "string") return null;
  const match = /[0-9][0-9,]*(?:\.[0-9]+)?/.exec(value);
  if (!match) return null;
  const parsed = Number(match[0].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** New-ad count from an after-text like "3 new ads" / "5 new ads launched". */
function newAdCount(afterText) {
  const count = firstNumber(afterText);
  return count ?? 1;
}

/**
 * First currency-prefixed amount in an offer string, with its currency
 * marker ("₹1,299" -> { currency: "₹", amount: 1299 }). Percent-off, BOGO,
 * and bare-number texts carry no currency marker and return null — those
 * are offer changes, never price drops (issue #2488).
 */
function currencyAmount(value) {
  if (typeof value !== "string") return null;
  const match =
    /(₹|\brs\.?|[$€£]|\b(?:usd|eur|gbp)\b)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i.exec(
      value,
    );
  if (!match) return null;
  const amount = Number(match[2].replaceAll(",", ""));
  if (!Number.isFinite(amount)) return null;
  return { currency: match[1].toLowerCase().replace(/\.$/, ""), amount };
}

/**
 * True only when both sides carry the SAME currency symbol or code
 * (₹, $, USD are distinct) and the after amount is below the before amount.
 */
function isPriceDrop(move) {
  const before = currencyAmount(move.beforeText);
  const after = currencyAmount(move.afterText);
  return (
    before !== null &&
    after !== null &&
    before.currency === after.currency &&
    after.amount < before.amount
  );
}

function captureDate(capturedAt) {
  if (typeof capturedAt !== "string") return "unknown date";
  const parsed = Date.parse(capturedAt);
  return Number.isFinite(parsed) ? capturedAt.slice(0, 10) : "unknown date";
}

function moveChangeText(move) {
  const before = typeof move.beforeText === "string" ? move.beforeText : null;
  const after = typeof move.afterText === "string" ? move.afterText : null;
  if (before && after) return `"${before}" → "${after}"`;
  return after ?? before ?? "";
}

function moveLine(move, index) {
  const brand = typeof move.brand === "string" ? move.brand : move.domain;
  const change = moveChangeText(move);
  const links = [publicUrl(move.adsPath), publicUrl(move.timelinePath)]
    .filter(Boolean)
    .join(" · ");
  const head = `${index + 1}. ${brand} — ${move.field}: ${change} (captured ${captureDate(move.capturedAt)})`;
  return links ? `${head}\n   ${links}` : head;
}

function buildPost(moves) {
  const list = Array.isArray(moves) ? moves : [];
  const newAds = list
    .filter((move) => move.field === FIELD_NEW_ADS)
    .reduce((total, move) => total + newAdCount(move.afterText), 0);
  const offerChanges = list.filter((move) => move.field === FIELD_OFFER_PRICE).length;
  const priceDrops = list.filter(
    (move) => move.field === FIELD_OFFER_PRICE && isPriceDrop(move),
  ).length;
  const brands = new Set(list.map((move) => move.domain).filter(Boolean));
  const topMoves = list.slice(0, TOP_MOVES_LIMIT);

  const lines = [
    "Weekly competitor offer moves — what changed on tracked brands this week.",
    "",
    `This week: ${newAds} new ads, ${offerChanges} offer changes, ${priceDrops} price drops across ${brands.size} brands.`,
    "",
  ];
  if (topMoves.length === 0) {
    lines.push("A quiet week: no stored moves on any brand with a public page.");
  } else {
    lines.push("Top moves:");
    for (const [index, move] of topMoves.entries()) {
      lines.push(moveLine(move, index));
    }
  }
  lines.push(
    "",
    "Every line is a stored capture; the links are the public pages with the underlying proof. Brands that did not move are omitted, not zeroed.",
  );
  return lines.join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.get("dry-run") !== true) {
  fail("only --dry-run is supported; this script never posts anywhere.");
}
const fixturePath = args.get("fixture");
if (typeof fixturePath !== "string" || !fixturePath) {
  fail("usage: node scripts/weekly-offer-moves-report.mjs --dry-run --fixture <json>");
}

let moves;
try {
  moves = JSON.parse(readFileSync(fixturePath, "utf8"));
} catch (error) {
  fail(`cannot read fixture ${fixturePath}: ${error instanceof Error ? error.message : error}`);
}
if (!Array.isArray(moves)) {
  fail(`fixture ${fixturePath} must be a JSON array of moves`);
}

process.stdout.write(`${buildPost(moves)}\n`);
