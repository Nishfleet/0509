#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceFiles = [
  "app/routes/marketing.tsx",
  "app/routes/pricing.tsx",
  "app/components/brand-wordmark.tsx",
  "app/components/pricing-section.tsx",
  "app/app.css",
  "app/root.tsx",
  "app/routes.ts",
  "app/lib/public-markdown.ts",
  "app/lib/pricing.ts",
  "wrangler.jsonc",
];
const staleSignals = [
  "The market moves after you log off",
  "After-hours market intelligence",
  "Enter pilot",
  "Intelligence room",
  "pricing-region",
  "Fraunces",
  "Manrope",
  "Rs 2,500",
  "Rs 7,500",
  "APP_REGION_DEFAULT",
  "Dodo preview",
  "Buyer currency is served from checkout preview.",
  "Prices are loaded from Dodo",
  "No unlimited claims",
  "Meta beta access",
  "Dodo price syncing",
  "Loading local monthly price",
  "Loading local annual price",
  "Loading local pack price",
  "Monthly price loading",
  "Annual price loading",
  "market lanes watched",
  "source states separated",
  "source trail per move",
  "decision scan",
  "Start with Scout",
];
const requiredSourceSignals = [
  "Know when competitors change the offer.",
  "Stop finding out after the sales call.",
  "Recommended launch plan",
  "Start with Starter",
  "Localized at checkout",
  "DODO_0509_ADAPTIVE_CURRENCY",
];
const requiredBuildSignals = [
  "Know when competitors change the offer.",
  "Stop finding out after the sales call.",
  "Recommended launch plan",
  "Start with Starter",
];

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function collectBuildFiles(dir) {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) {
    return [];
  }

  return readdirSync(absolute).flatMap((entry) => {
    const relative = join(dir, entry);
    const target = join(root, relative);
    const stats = statSync(target);
    if (stats.isDirectory()) {
      return collectBuildFiles(relative);
    }
    return /\.(?:html|js|css)$/.test(entry) ? [relative] : [];
  });
}

function fail(message) {
  console.error(`public-home-current check failed: ${message}`);
  process.exitCode = 1;
}

const sourceBundle = sourceFiles.map(readText).join("\n");
for (const signal of staleSignals) {
  if (sourceBundle.includes(signal)) {
    fail(`stale public-home signal remains in source: ${signal}`);
  }
}
for (const signal of requiredSourceSignals) {
  if (!sourceBundle.includes(signal)) {
    fail(`fresh public-home signal missing from source: ${signal}`);
  }
}

if (!process.argv.includes("--source-only")) {
  const buildFiles = collectBuildFiles("build");
  if (buildFiles.length === 0) {
    fail("build output is missing; run npm run build before the full check");
  }

  const buildBundle = buildFiles.map(readText).join("\n");
  for (const signal of staleSignals) {
    if (buildBundle.includes(signal)) {
      fail(`stale public-home signal remains in build output: ${signal}`);
    }
  }
  for (const signal of requiredBuildSignals) {
    if (!buildBundle.includes(signal)) {
      fail(`fresh public-home signal missing from build output: ${signal}`);
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("public-home-current check passed");
