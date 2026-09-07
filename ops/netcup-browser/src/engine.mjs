// 0509 Netcup renderer — job engines.
//
// Three bounded job executors, each with a fresh isolated context and
// guaranteed cleanup in `finally` (timeout/crash included):
//
//   meta_discovery   -> Camofox HTTP API (anti-detection engine for the Meta
//                       Ad Library): create tab -> verify final URL against
//                       policy -> bounded ariaSnapshot evidence -> optional
//                       JPEG screenshot evidence -> close tab.
//   landing_snapshot -> Node-side per-hop redirect validation, then
//                       chrome-headless-shell --dump-dom (rendered HTML,
//                       1 MiB cap) and --screenshot (PNG -> ffmpeg JPEG,
//                       3 MiB cap).
//   report_pdf       -> chrome-headless-shell --print-to-pdf of the
//                       worker-signed same-origin 0509 share URL (10 MiB cap).
//
// Nothing here ever logs bodies, cookies, or tokens; outputs are bounded
// evidence artifacts with content type + SHA-256.

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  followRedirects,
  validateMetaUrl,
  buildShareUrl,
  isBlockedIp,
  resolveHost,
} from "./url-policy.mjs";

export class BoundedError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = "BoundedError";
    this.code = code;
    this.status = status;
  }
}

export const DEFAULT_BOUNDS = {
  landingHtmlMaxBytes: 1_000_000, // 0509: MAX_RENDERED_HTML_BYTES
  landingJpegMaxBytes: 3_000_000, // 0509: MAX_RENDERED_SCREENSHOT_BYTES
  metaSnapshotMaxBytes: 512_000,
  metaScreenshotRawMaxBytes: 8_000_000, // PNG before conversion
  pdfMaxBytes: 10_000_000,
};

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertBounded(buffer, maxBytes, code) {
  if (buffer.length > maxBytes) {
    throw new BoundedError(code, `artifact exceeds ${maxBytes} byte cap`);
  }
  return buffer;
}

export async function writeArtifact(artifactsDir, name, buffer, contentType) {
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(artifactsDir, name), buffer);
  return {
    name,
    contentType,
    bytes: buffer.length,
    sha256: sha256Hex(buffer),
    path: path.join(artifactsDir, name),
  };
}

/**
 * Run a child process with a hard kill-on-timeout, bounded stdout capture and
 * signal support. Never throws on non-zero exit — returns { code, stdout }.
 */
export async function runProcess(bin, args, { signal, timeoutMs = 60_000, maxStdoutBytes = 2_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutExceeded = false;
    let settled = false;

    const kill = (sig = "SIGKILL") => {
      try {
        child.kill(sig);
      } catch {
        /* already gone */
      }
    };
    const onAbort = () => {
      if (settled) return;
      kill("SIGKILL");
      reject(new BoundedError("job_aborted", "job aborted by deadline or shutdown"));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      kill("SIGKILL");
      reject(new BoundedError("engine_timeout", `engine process exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        return reject(new BoundedError("job_aborted", "job aborted by deadline or shutdown"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      if (stdoutExceeded) return;
      if (stdout.length + chunk.length > maxStdoutBytes) {
        stdoutExceeded = true;
        stdout = stdout.subarray(0, maxStdoutBytes);
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length + chunk.length > 512_000) return;
      stderr = Buffer.concat([stderr, chunk]);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new BoundedError("engine_spawn_failed", `failed to spawn ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, stdoutExceeded });
    });
  });
}

// NOTE: Camofox engine traffic always uses the real global fetch — the
// Camofox base URL is loopback infrastructure configured by the operator,
// never client input, so it must NOT be overridable by the landing-probe
// fetchImpl test hook (which exists for SSRF-guarded client-controlled URLs).
async function camofoxRequest(baseUrl, accessKey, method, pathname, { body, signal } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(accessKey ? { authorization: `Bearer ${accessKey}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw new BoundedError(
      "engine_http_error",
      `Camofox ${method} ${pathname} failed: ${response.status} ${payload?.error ?? ""}`.trim(),
    );
  }
  return { status: response.status, payload, raw: text };
}

async function camofoxGetRaw(baseUrl, accessKey, pathname, { signal, maxBytes }) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: accessKey ? { authorization: `Bearer ${accessKey}` } : {},
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new BoundedError("engine_http_error", `Camofox GET ${pathname} failed: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return assertBounded(Buffer.from(arrayBuffer), maxBytes, "evidence_too_large");
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new BoundedError("job_aborted", "job aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new BoundedError("job_aborted", "job aborted"));
    }, { once: true });
  });

// --- meta_discovery --------------------------------------------------------

export async function runMetaDiscovery({ url, bounds = {}, camofox = {}, signal, artifactsDir, now = Date.now, ffmpegBin }) {
  const b = { ...DEFAULT_BOUNDS, ...bounds };
  const target = validateMetaUrl(url); // re-validate at execution time
  const { baseUrl, accessKey } = camofox;
  const jobId = camofox.userIdFor ? camofox.userIdFor() : "0509-renderer-meta";
  const startedAt = now();
  let tabId = null;

  try {
    const created = await camofoxRequest(baseUrl, accessKey, "POST", "/tabs", {
      body: { userId: jobId, sessionKey: jobId, url: target.toString() },
      signal,
    });
    tabId = created.payload?.tabId;
    if (!tabId) {
      throw new BoundedError("engine_no_tab", "Camofox did not return a tabId");
    }

    // Wait for the navigation to settle, then verify the TRUE final URL
    // against policy (covers Meta redirects and consent detours).
    let finalUrl = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const stats = await camofoxRequest(baseUrl, accessKey, "GET", `/tabs/${tabId}/stats`, {
        signal,
      });
      const url = stats.payload?.url;
      if (typeof url === "string" && url.length > 0) {
        finalUrl = validateMetaUrl(url).toString();
        break;
      }
      await sleep(1_000, signal);
    }
    if (!finalUrl) {
      throw new BoundedError("engine_nav_timeout", "Camofox navigation did not settle in time");
    }

    // Bounded ariaSnapshot evidence.
    const snapshot = await camofoxGetRaw(baseUrl, accessKey, `/tabs/${tabId}/snapshot`, {
      signal,
      maxBytes: b.metaSnapshotMaxBytes,
    });
    const snapshotArtifact = await writeArtifact(
      artifactsDir,
      "snapshot.json",
      snapshot,
      "application/json; charset=utf-8",
    );

    // Bounded JPEG screenshot evidence (PNG from the engine, converted with ffmpeg).
    const png = await camofoxGetRaw(baseUrl, accessKey, `/tabs/${tabId}/screenshot`, {
      signal,
      maxBytes: b.metaScreenshotRawMaxBytes,
    });
    const jpeg = await pngToJpeg(png, b.landingJpegMaxBytes, { signal, ffmpegBin });
    const screenshotArtifact = await writeArtifact(
      artifactsDir,
      "screenshot.jpeg",
      jpeg,
      "image/jpeg",
    );

    return {
      finalUrl,
      artifacts: [snapshotArtifact, screenshotArtifact],
      evidence: {
        snapshotSha256: snapshotArtifact.sha256,
        screenshotSha256: screenshotArtifact.sha256,
        snapshotBytes: snapshotArtifact.bytes,
        screenshotBytes: screenshotArtifact.bytes,
      },
    };
  } finally {
    if (tabId) {
      await camofoxRequest(baseUrl, accessKey, "DELETE", `/tabs/${tabId}`, { signal }).catch(() => {});
    }
  }
}

// --- landing_snapshot ------------------------------------------------------

export async function runLandingSnapshot({ url, bounds = {}, chrome = {}, signal, fetchImpl, lookup, artifactsDir, now = Date.now, ffmpegBin }) {
  const b = { ...DEFAULT_BOUNDS, ...bounds };
  const startedAt = now();
  const { bin: chromeBin, tmpRoot } = chrome;

  // Per-hop redirect validation (max 5, re-resolve + re-check every hop).
  const followed = await followRedirects(url, { fetchImpl, lookup, signal, timeoutMs: 20_000 });
  if (followed.status >= 400) {
    throw new BoundedError(`http_status_${followed.status}`, `landing page returned HTTP ${followed.status}`);
  }
  const finalUrl = followed.url.toString();

  const profileDir = path.join(tmpRoot, `landing-${sha256Hex(finalUrl).slice(0, 16)}`);
  try {
    // Rendered HTML via --dump-dom (bounded at 1 MiB).
    const htmlRun = await runProcess(chromeBin, [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--dump-dom",
      "--virtual-time-budget=5000",
      `--timeout=30000`,
      finalUrl,
    ], { signal, timeoutMs: 40_000, maxStdoutBytes: b.landingHtmlMaxBytes + 1024 });
    if (htmlRun.code !== 0) {
      throw new BoundedError("engine_html_failed", `chrome --dump-dom exited ${htmlRun.code}`);
    }
    if (htmlRun.stdoutExceeded) {
      throw new BoundedError("html_too_large", `rendered HTML exceeds ${b.landingHtmlMaxBytes} byte cap`);
    }
    const html = assertBounded(htmlRun.stdout, b.landingHtmlMaxBytes, "html_too_large");
    const htmlArtifact = await writeArtifact(artifactsDir, "landing.html", html, "text/html; charset=utf-8");

    // Mobile-viewport screenshot: PNG from chrome, JPEG via ffmpeg (3 MiB cap).
    const pngRun = await runProcess(chromeBin, [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--force-device-scale-factor=2",
      "--window-size=390,844",
      `--screenshot=${path.join(profileDir, "shot.png")}`,
      "--virtual-time-budget=5000",
      `--timeout=30000`,
      finalUrl,
    ], { signal, timeoutMs: 40_000 });
    if (pngRun.code !== 0) {
      throw new BoundedError("engine_screenshot_failed", `chrome --screenshot exited ${pngRun.code}`);
    }
    const { readFile } = await import("node:fs/promises");
    const png = assertBounded(await readFile(path.join(profileDir, "shot.png")), b.metaScreenshotRawMaxBytes, "screenshot_too_large");
    const jpeg = await pngToJpeg(png, b.landingJpegMaxBytes, { signal, ffmpegBin });
    const jpegArtifact = await writeArtifact(artifactsDir, "landing.jpeg", jpeg, "image/jpeg");

    return {
      finalUrl,
      httpStatus: followed.status,
      artifacts: [htmlArtifact, jpegArtifact],
      evidence: {
        htmlSha256: htmlArtifact.sha256,
        jpegSha256: jpegArtifact.sha256,
        htmlBytes: htmlArtifact.bytes,
        jpegBytes: jpegArtifact.bytes,
        redirects: followed.redirects ?? 0,
      },
    };
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- report_pdf ------------------------------------------------------------

export async function runReportPdf({ token, bounds = {}, chrome = {}, signal, fetchImpl, lookup, artifactsDir, origin, now = Date.now }) {
  const b = { ...DEFAULT_BOUNDS, ...bounds };
  const startedAt = now();
  const { bin: chromeBin, tmpRoot } = chrome;
  const url = buildShareUrl(token, origin); // re-validates the token

  // Defense in depth: the fixed 0509 origin must itself resolve to a public IP.
  await resolveHost(url.hostname, { lookup });

  const profileDir = path.join(tmpRoot, `pdf-${sha256Hex(token).slice(0, 16)}`);
  const pdfPath = path.join(profileDir, "report.pdf");
  try {
    const pdfRun = await runProcess(chromeBin, [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--print-to-pdf=${pdfPath}`,
      "--no-pdf-header-footer",
      "--virtual-time-budget=8000",
      `--timeout=45000`,
      url.toString(),
    ], { signal, timeoutMs: 60_000 });
    if (pdfRun.code !== 0) {
      throw new BoundedError("engine_pdf_failed", `chrome --print-to-pdf exited ${pdfRun.code}`);
    }
    const { readFile } = await import("node:fs/promises");
    const pdf = assertBounded(await readFile(pdfPath), b.pdfMaxBytes, "pdf_too_large");
    const artifact = await writeArtifact(artifactsDir, "report.pdf", pdf, "application/pdf");
    return {
      url: url.toString(),
      artifacts: [artifact],
      evidence: { pdfSha256: artifact.sha256, pdfBytes: artifact.bytes },
    };
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- shared helpers ----------------------------------------------------------

async function pngToJpeg(png, maxBytes, { signal, ffmpegBin = process.env.RENDERER_FFMPEG_BIN || "ffmpeg", tmpRoot = process.env.RENDERER_TMP_ROOT || "/tmp" } = {}) {
  const dir = path.join(tmpRoot, `jpeg-${sha256Hex(png).slice(0, 16)}`);
  await mkdir(dir, { recursive: true });
  const pngPath = path.join(dir, "in.png");
  const jpgPath = path.join(dir, "out.jpg");
  try {
    await writeFile(pngPath, png);
    const convert = await runProcess(ffmpegBin, [
      "-y",
      "-loglevel",
      "error",
      "-i",
      pngPath,
      "-q:v",
      "3",
      jpgPath,
    ], { signal, timeoutMs: 30_000 });
    if (convert.code !== 0) {
      throw new BoundedError("engine_jpeg_failed", `ffmpeg conversion exited ${convert.code}`);
    }
    const { readFile } = await import("node:fs/promises");
    const jpeg = assertBounded(await readFile(jpgPath), maxBytes, "jpeg_too_large");
    return jpeg;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export { isBlockedIp };
