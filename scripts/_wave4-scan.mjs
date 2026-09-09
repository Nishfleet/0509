#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SURFACES = ["app/app.css", "app/components", "app/routes"];
const EXTS = new Set([".ts", ".tsx", ".css"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) yield* walk(full);
    else if (EXTS.has(full.slice(full.lastIndexOf(".")))) yield full;
  }
}

function* walkPath(target) {
  const stats = statSync(target);
  if (stats.isDirectory()) yield* walk(target);
  else if (EXTS.has(target.slice(target.lastIndexOf(".")))) yield target;
}

const br = {};
const ff = {};
const hex = {};
const grad = {};
const imp = {};

const BORDER_RADIUS_DECL = /(?:^|[^-\w])border(?:-[a-z]+)*-radius\s*:\s*([^;}\n]+)/g;
const FONT_FAMILY_DECL = /(?:^|[^-\w])font-family\s*:\s*([^;}\n]+)/g;
const HEX_DECL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
const GRAD_DECL = /\b(?:linear|radial|conic)-gradient\s*\(/g;
const IMP_DECL = /!important\b/g;

for (const target of SURFACES) {
  for (const file of walkPath(join(ROOT, target))) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, "utf8");

    for (const m of src.matchAll(BORDER_RADIUS_DECL)) {
      const v = m[1].trim();
      if (v.startsWith("var(")) continue;
      br[v] = (br[v] || 0) + 1;
    }
    for (const m of src.matchAll(FONT_FAMILY_DECL)) {
      const v = m[1].trim();
      if (v.startsWith("var(") || v.startsWith("inherit")) continue;
      ff[v] = (ff[v] || 0) + 1;
    }
    for (const m of src.matchAll(HEX_DECL)) {
      const v = m[0];
      if (hex[v]) hex[v].count += 1; else hex[v] = { count: 1, first: rel };
    }
    let gm;
    while ((gm = GRAD_DECL.exec(src))) {
      const key = `${rel}:${gm.index}`;
      grad[key] = 1;
    }
    for (const m of src.matchAll(IMP_DECL)) {
      imp[rel] = (imp[rel] || 0) + 1;
    }
  }
}

console.log("=== border-radius distinct values ===");
for (const [k, v] of Object.entries(br).sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`);
console.log("\n=== font-family distinct values ===");
for (const [k, v] of Object.entries(ff).sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`);
console.log("\n=== hex distinct values (top 60) ===");
const hexSorted = Object.entries(hex).sort((a, b) => b[1].count - a[1].count);
for (const [k, v] of hexSorted.slice(0, 80)) console.log(`${k}: ${v.count} (first in ${v.first})`);
console.log("\n=== gradient occurrence file counts ===");
console.log(`Total gradient matches: ${Object.keys(grad).length}`);
console.log("\n=== !important per file ===");
for (const [k, v] of Object.entries(imp).sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`);
console.log(`\nTotal !important: ${Object.values(imp).reduce((s, x) => s + x, 0)}`);
