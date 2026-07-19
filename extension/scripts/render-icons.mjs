#!/usr/bin/env node
/**
 * Renders extension/icons/icon-{16,32,48,128}.png from the same "05:09 clock"
 * motif as extension/icons/icon.svg.
 *
 * Zero dependencies: instead of rasterizing the SVG with sharp/resvg, this
 * script draws the identical geometry procedurally (rounded square, clock
 * ring, two hands at 05:09, green pivot) with 4x4 supersampling, and encodes
 * the PNGs by hand using only node:zlib for the IDAT deflate stream.
 *
 * Usage: node extension/scripts/render-icons.mjs
 * Output PNGs are committed to the repo; rerun only if the motif changes
 * (keep icon.svg and the geometry below in sync).
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
const SIZES = [16, 32, 48, 128];

// Geometry on a 128x128 canvas — mirrors icon.svg exactly.
const BONE = [0xf4, 0xf1, 0xe8];
const INK = [0x17, 0x16, 0x11];
const GREEN = [0x16, 0xc4, 0x7f];

const RECT_RADIUS = 28;
const RING = { cx: 64, cy: 64, r: 40, width: 9 };
// 05:09 → hour hand 154.5deg, minute hand 54deg (clockwise from 12).
const HOUR_HAND = { x1: 64, y1: 64, x2: 73.5, y2: 83.9, width: 9 };
const MINUTE_HAND = { x1: 64, y1: 64, x2: 88.3, y2: 46.4, width: 9 };
const PIVOT = { cx: 64, cy: 64, r: 7 };

// --- signed-distance helpers (negative = inside) ---

function sdRoundedSquare(x, y, size, radius) {
  const half = size / 2;
  const qx = Math.abs(x - half) - (half - radius);
  const qy = Math.abs(y - half) - (half - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

function sdRing(x, y, ring) {
  return Math.abs(Math.hypot(x - ring.cx, y - ring.cy) - ring.r) - ring.width / 2;
}

function sdCapsule(x, y, seg) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const px = x - seg.x1;
  const py = y - seg.y1;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - t * dx, py - t * dy) - seg.width / 2;
}

// Layers composited top-down per sample: first hit wins.
const LAYERS = [
  { color: GREEN, sd: (x, y) => sdCircle(x, y, PIVOT.cx, PIVOT.cy, PIVOT.r) },
  { color: INK, sd: (x, y) => sdCapsule(x, y, HOUR_HAND) },
  { color: INK, sd: (x, y) => sdCapsule(x, y, MINUTE_HAND) },
  { color: INK, sd: (x, y) => sdRing(x, y, RING) },
  { color: BONE, sd: (x, y) => sdRoundedSquare(x, y, 128, RECT_RADIUS) },
];

function renderRgba(size) {
  const scale = 128 / size;
  const ss = 4; // 4x4 supersampling
  const rgba = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) * scale;
          const y = (py + (sy + 0.5) / ss) * scale;
          for (const layer of LAYERS) {
            if (layer.sd(x, y) <= 0) {
              r += layer.color[0];
              g += layer.color[1];
              b += layer.color[2];
              a += 255;
              break;
            }
          }
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      // Straight-alpha average; covered samples carry their color.
      rgba[i] = a === 0 ? 0 : Math.round((r / a) * 255);
      rgba[i + 1] = a === 0 ? 0 : Math.round((g / a) * 255);
      rgba[i + 2] = a === 0 ? 0 : Math.round((b / a) * 255);
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

// --- minimal PNG encoder (RGBA8, no interlace) ---

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(renderRgba(size), size));
  console.log(`wrote ${file}`);
}
