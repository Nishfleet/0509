// 0509 Netcup renderer — loopback HTTP service.
//
// Binds 127.0.0.1 only. Every mutating/reading surface except /healthz and
// /readyz is HMAC-authenticated (see auth.mjs). The service is the narrow
// authenticated boundary a later 0509 pull/relay or ingress adapter can
// implement against; it never exposes Camofox port 9377, raw CDP, cookies,
// arbitrary evaluate, or a general-purpose browser endpoint.
//
// Routes:
//   GET  /healthz                 cheap liveness (no dependencies)
//   GET  /readyz                  real readiness (engine + binaries + dirs)
//   POST /jobs                    enqueue a job (meta_discovery | landing_snapshot | report_pdf)
//   GET  /jobs/:jobId             job status / result envelope
//   GET  /artifacts/:jobId/:name  bounded artifact bytes (+ sha256 header)
//
// Logging never includes bodies, cookies, tokens, or the Authorization header.

import http from "node:http";
import path from "node:path";
import os from "node:os";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";

import { HmacVerifier, sha256Hex, AuthError } from "./auth.mjs";
import { JobQueue, QueueError, QueueFullError } from "./job-queue.mjs";
import {
  validateMetaUrl,
  assertPublicHttpUrl,
  parseHttpUrl,
  isBlockedIp,
  validatePdfToken,
  UrlPolicyError,
  resolveHost,
} from "./url-policy.mjs";
import {
  runMetaDiscovery,
  runLandingSnapshot,
  runReportPdf,
  writeArtifact,
  BoundedError,
  DEFAULT_BOUNDS,
} from "./engine.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BODY_FIELDS = 16;
const JOB_KINDS = new Set(["meta_discovery", "landing_snapshot", "report_pdf"]);
const ARTIFACT_NAME_PATTERN = /^[a-z0-9._-]{1,120}$/i;

function log(level, msg, fields = {}) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n");
}

function readBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new BoundedError("body_too_large", `request body exceeds ${maxBytes} bytes`, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendError(res, error) {
  const status = error?.status ?? 500;
  const code = error?.code ?? (status >= 500 ? "internal_error" : "bad_request");
  const message = status >= 500 ? "internal error" : (error?.message ?? "bad request");
  sendJson(res, status, { ok: false, error: { code, message } });
}

function nowMs() {
  return Date.now();
}

async function findChromeShell() {
  const candidates = [
    process.env.RENDERER_CHROME_BIN,
    "/home/nish/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
    "/home/nish/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function resolveConfig(env = process.env, home = os.homedir()) {
  return {
    port: Number(env.RENDERER_PORT || 9382),
    bind: env.RENDERER_BIND || "127.0.0.1",
    credentialsDir: env.RENDERER_CREDENTIALS_DIR || path.join(home, ".config", "0509-renderer"),
    stateDir: env.RENDERER_STATE_DIR || path.join(home, ".local", "share", "0509-renderer"),
    tmpRoot: env.RENDERER_TMP_ROOT || path.join(home, ".local", "share", "0509-renderer", "tmp"),
    artifactsRoot: env.RENDERER_ARTIFACTS_ROOT || path.join(home, ".local", "share", "0509-renderer", "artifacts"),
    chromeBin: env.RENDERER_CHROME_BIN || null,
    ffmpegBin: env.RENDERER_FFMPEG_BIN || "ffmpeg",
    camofoxBaseUrl: env.RENDERER_CAMOFOX_BASE || "http://127.0.0.1:9377",
    camofoxAccessKey: env.RENDERER_CAMOFOX_ACCESS_KEY || null,
    pdfOrigin: env.RENDERER_PDF_ORIGIN || "https://0509.io",
    concurrency: Number(env.RENDERER_CONCURRENCY || 1),
    maxQueued: Number(env.RENDERER_MAX_QUEUED || 4),
    retentionMs: Number(env.RENDERER_RETENTION_MS || 24 * 60 * 60 * 1000),
    deadlineMs: {
      meta_discovery: Number(env.RENDERER_DEADLINE_META_MS || 90_000),
      landing_snapshot: Number(env.RENDERER_DEADLINE_LANDING_MS || 90_000),
      report_pdf: Number(env.RENDERER_DEADLINE_PDF_MS || 120_000),
    },
    bounds: {
      landingHtmlMaxBytes: Number(env.RENDERER_HTML_MAX || DEFAULT_BOUNDS.landingHtmlMaxBytes),
      landingJpegMaxBytes: Number(env.RENDERER_JPEG_MAX || DEFAULT_BOUNDS.landingJpegMaxBytes),
      pdfMaxBytes: Number(env.RENDERER_PDF_MAX || DEFAULT_BOUNDS.pdfMaxBytes),
    },
  };
}

/**
 * Create the renderer service. `config` from resolveConfig(); `secrets` from
 * HmacVerifier.fromCredentialFiles() (or injected in tests).
 */
export function createRendererService(config, secrets) {
  const verifier = secrets instanceof HmacVerifier ? secrets : new HmacVerifier(secrets);
  const results = new Map(); // jobId -> result envelope
  const queue = new JobQueue({
    concurrency: config.concurrency,
    maxQueued: config.maxQueued,
    retentionMs: config.retentionMs,
    now: nowMs,
    onJob: (job, { signal }) => runJob(job, { signal }),
  });

  async function runJob(job, { signal }) {
    const started = Date.now();
    let detail;
    switch (job.kind) {
      case "meta_discovery":
        detail = await runMetaDiscovery({
          url: job.params.url,
          camofox: {
            baseUrl: config.camofoxBaseUrl,
            accessKey: config.camofoxAccessKey,
            userIdFor: () => `0509-renderer-meta-${job.jobId}`,
          },
          artifactsDir: artifactDirFor(job.jobId),
          bounds: config.bounds,
          signal,
          fetchImpl: config.fetchImpl,
          ffmpegBin: config.ffmpegBin,
        });
        break;
      case "landing_snapshot":
        detail = await runLandingSnapshot({
          url: job.params.url,
          chrome: { bin: await chromeBin(config), tmpRoot: config.tmpRoot },
          artifactsDir: artifactDirFor(job.jobId),
          bounds: config.bounds,
          signal,
          fetchImpl: config.fetchImpl,
          lookup: config.lookup,
          ffmpegBin: config.ffmpegBin,
        });
        break;
      case "report_pdf":
        detail = await runReportPdf({
          token: job.params.token,
          origin: config.pdfOrigin,
          chrome: { bin: await chromeBin(config), tmpRoot: config.tmpRoot },
          artifactsDir: artifactDirFor(job.jobId),
          bounds: config.bounds,
          signal,
          lookup: config.lookup,
        });
        break;
      default:
        throw new QueueError("invalid_job_kind", `unknown job kind ${job.kind}`);
    }
    return {
      ...detail,
      engineTotalMs: Date.now() - started,
      tenant: job.tenant,
      workspace: job.workspace,
    };
  }

  function artifactDirFor(jobId) {
    return path.join(config.artifactsRoot, jobId);
  }

  function validateJobPayload(body) {    const { kind, tenant, workspace, jobId, idempotencyKey, params, deadlineMs } = body ?? {};
    if (!JOB_KINDS.has(kind)) throw new QueueError("invalid_job_kind", `unknown job kind ${kind}`);
    if (typeof tenant !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(tenant)) {
      throw new QueueError("invalid_tenant", "tenant must be 1-64 chars [A-Za-z0-9._-]");
    }
    if (typeof workspace !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(workspace)) {
      throw new QueueError("invalid_workspace", "workspace must be 1-64 chars [A-Za-z0-9._-]");
    }
    if (typeof jobId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(jobId)) {
      throw new QueueError("invalid_job_id", "jobId must be 1-128 chars [A-Za-z0-9._-]");
    }
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || idempotencyKey.length > 128)) {
      throw new QueueError("invalid_idempotency_key", "idempotencyKey must be <= 128 chars");
    }
    const paramsCount = params && typeof params === "object" ? Object.keys(params).length : 0;
    if (paramsCount > MAX_BODY_FIELDS) {
      throw new QueueError("invalid_params", "params has too many fields");
    }
    // Per-kind parameter + policy validation happens BEFORE enqueue.
    switch (kind) {
      case "meta_discovery":
        if (typeof params?.url !== "string") throw new QueueError("invalid_params", "params.url required");
        validateMetaUrl(params.url);
        break;
      case "landing_snapshot":
        if (typeof params?.url !== "string") throw new QueueError("invalid_params", "params.url required");
        // Syntactic pre-validation at enqueue time (scheme, credentials,
        // ports, literal private IPs). DNS resolution and redirect re-checks
        // happen at execution inside the engine.
        validateLandingEnvelope(params.url);
        break;
      case "report_pdf":
        if (typeof params?.token !== "string") throw new QueueError("invalid_params", "params.token required");
        validatePdfToken(params.token);
        break;
    }
    return { kind, tenant, workspace, jobId, idempotencyKey, params, deadlineMs };
  }

  /** Enqueue-time syntactic landing URL check (no DNS — that happens per hop at execution). */
function validateLandingEnvelope(raw) {
  const url = assertPublicHttpUrl(parseHttpUrl(raw));
  if (isBlockedIp(url.hostname)) {
    throw new UrlPolicyError("private_ip", `literal address ${url.hostname} blocked`);
  }
  return url;
}

const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      log("warn", "request failed", { path: req.url, code: error?.code || "unknown" });
      sendError(res, error);
    }
  });

  async function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, service: "0509-renderer" });
    }
    if (req.method === "GET" && url.pathname === "/readyz") {
      const checks = await readinessChecks();
      return sendJson(res, checks.ready ? 200 : 503, { ok: checks.ready, checks });
    }

    if (req.method === "POST" && url.pathname === "/jobs") {
      const raw = await readBody(req);
      const bodyHash = sha256Hex(raw);
      let body;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new AuthError("malformed_body", "request body must be JSON");
      }
      // Authenticate BEFORE validating the payload: unauthenticated requests
      // must fail as 401, never leak validation details.
      verifier.verify({
        authorization: req.headers.authorization,
        tenant: typeof body?.tenant === "string" ? body.tenant : "",
        workspace: typeof body?.workspace === "string" ? body.workspace : "",
        jobId: typeof body?.jobId === "string" ? body.jobId : "",
        method: "POST",
        path: "/jobs",
        bodyHash,
      });
      const job = validateJobPayload(body);
      if (job.deadlineMs !== undefined) {
        const budgetMs = config.deadlineMs[job.kind];
        // Absolute deadline, capped at the per-kind budget.
        job.maxDeadlineBudgetMs = budgetMs;
        job.defaultDeadlineMs = budgetMs;
      } else {
        job.defaultDeadlineMs = config.deadlineMs[job.kind];
      }
      job.enqueuedAt = Date.now();
      const submitted = queue.submit(job);
      submitted.promise.then((envelope) => {
        results.set(envelope.jobId, envelope);
        log("info", "job finished", {
          jobId: envelope.jobId,
          kind: envelope.kind,
          status: envelope.status,
          engineMs: envelope.timingsMs?.engineMs,
          code: envelope.error?.code,
        });
      });
      return sendJson(res, submitted.cached ? 200 : 202, {
        ok: true,
        jobId: job.jobId,
        status: submitted.cached ? "completed" : "queued",
        cached: submitted.cached,
        idempotencyKey: submitted.idempotencyKey,
        queue: queue.stats(),
      });
    }

    const jobsMatch = req.method === "GET" && url.pathname.match(/^\/jobs\/([A-Za-z0-9._-]{1,128})$/);
    if (jobsMatch) {
      const jobId = jobsMatch[1];
      const tenant = url.searchParams.get("tenant");
      const workspace = url.searchParams.get("workspace");
      requireGetAuth(req, { tenant, workspace, jobId, path: url.pathname });
      const envelope = results.get(jobId);
      if (!envelope) return sendJson(res, 404, { ok: false, error: { code: "job_not_found", message: "no such job" } });
      return sendJson(res, 200, { ok: true, result: publicEnvelope(envelope) });
    }

    const artifactsMatch =
      req.method === "GET" && url.pathname.match(/^\/artifacts\/([A-Za-z0-9._-]{1,128})\/([A-Za-z0-9._-]{1,120})$/);
    if (artifactsMatch) {
      const [, jobId, name] = artifactsMatch;
      if (!ARTIFACT_NAME_PATTERN.test(name)) {
        throw new AuthError("bad_request", "invalid artifact name", 400);
      }
      const tenant = url.searchParams.get("tenant");
      const workspace = url.searchParams.get("workspace");
      requireGetAuth(req, { tenant, workspace, jobId, path: url.pathname });
      const envelope = results.get(jobId);
      const artifact = envelope?.artifacts?.find((a) => a.name === name);
      if (!artifact) return sendJson(res, 404, { ok: false, error: { code: "artifact_not_found", message: "no such artifact" } });
      res.writeHead(200, {
        "content-type": artifact.contentType,
        "content-length": artifact.bytes,
        "x-artifact-sha256": artifact.sha256,
        "x-artifact-bytes": String(artifact.bytes),
        "cache-control": "private, max-age=3600",
      });
      createReadStream(artifact.path).pipe(res);
      return;
    }

    return sendJson(res, 404, { ok: false, error: { code: "not_found", message: "no such route" } });
  }

  function requireGetAuth(req, { tenant, workspace, jobId, path: pathname }) {
    if (!tenant || !workspace) {
      throw new AuthError("missing_context", "tenant and workspace query params required");
    }
    verifier.verify({
      authorization: req.headers.authorization,
      tenant,
      workspace,
      jobId,
      method: "GET",
      path: pathname,
      bodyHash: sha256Hex(""),
    });
  }

  async function readinessChecks() {
    const checks = {};
    try {
      const response = await fetch(`${config.camofoxBaseUrl}/health`, {
        headers: config.camofoxAccessKey ? { authorization: `Bearer ${config.camofoxAccessKey}` } : {},
        signal: AbortSignal.timeout(3000),
      });
      const payload = await response.json().catch(() => null);
      checks.camofox = response.ok && payload?.ok === true;
    } catch {
      checks.camofox = false;
    }
    checks.chrome = (await chromeBin(config)) !== null;
    checks.credentials = verifier.activeSecret.length >= 32;
    for (const dir of [config.stateDir, config.tmpRoot, config.artifactsRoot]) {
      await mkdir(dir, { recursive: true });
    }
    checks.dirsWritable = true;
    const ready = checks.camofox && checks.chrome && checks.credentials && checks.dirsWritable;
    return { ready, ...checks, queue: queue.stats() };
  }

  function publicEnvelope(envelope) {
    const { tenant, workspace, artifacts, ...rest } = envelope;
    return {
      ...rest,
      artifacts: (artifacts ?? []).map(({ name, contentType, bytes, sha256 }) => ({
        name,
        contentType,
        bytes,
        sha256,
      })),
    };
  }

  async function startupSweep() {
    // Remove artifacts and temp profiles older than the retention window.
    for (const root of [config.artifactsRoot, config.tmpRoot]) {
      await mkdir(root, { recursive: true }).catch(() => {});
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(root).catch(() => []);
      const cutoff = Date.now() - config.retentionMs;
      for (const entry of entries) {
        try {
          const info = await stat(path.join(root, entry));
          if (info.mtimeMs < cutoff) {
            await rm(path.join(root, entry), { recursive: true, force: true });
            log("info", "startup sweep removed stale entry", { root, entry });
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
    server,
    queue,
    results,
    verifier,
    config,
    startupSweep,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.bind, () => resolve(server.address()));
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function buildEngines(config) {
  // Engine wiring lives in runJob; this hook keeps engine construction testable.
  return { config };
}

let chromeShellCache = null;
async function chromeBin(config) {
  if (config.chromeBin) return config.chromeBin;
  if (chromeShellCache === null) chromeShellCache = await findChromeShell();
  return chromeShellCache;
}

// --- main ----------------------------------------------------------------

async function main() {
  const config = resolveConfig();
  const secrets = await HmacVerifier.fromCredentialFiles({ directory: config.credentialsDir });
  const service = createRendererService(config, secrets);
  await service.startupSweep();
  await service.listen();
  log("info", "0509-renderer started", {
    bind: config.bind,
    port: config.port,
    camofox: config.camofoxBaseUrl,
    pdfOrigin: config.pdfOrigin,
    concurrency: config.concurrency,
    maxQueued: config.maxQueued,
    chrome: await chromeBin(config),
  });

  const shutdown = async (signal) => {
    log("info", "shutting down", { signal });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await service.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("uncaughtException", (error) => {
    log("error", "uncaughtException", { error: error.message });
    process.exit(1);
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  void main().catch((error) => {
    log("error", "startup failed", { error: error.message });
    process.exit(1);
  });
}

export { HmacVerifier, writeArtifact };
