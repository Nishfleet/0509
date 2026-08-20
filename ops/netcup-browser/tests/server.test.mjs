// HTTP-surface integration tests for the renderer service: HMAC auth end to
// end, the three job kinds, idempotency, replay, size caps, queue bounds, and
// cleanup. Uses a stub Camofox engine and fake chrome/ffmpeg binaries so the
// suite is deterministic and fast.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";

import { createRendererService, resolveConfig } from "../src/renderer-server.mjs";
import { HmacVerifier, buildCanonical, sign, sha256Hex } from "../src/auth.mjs";

const SECRET = "s".repeat(64);
const META_URL = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&q=hello";
// Low-entropy, obviously-fake 0509 share-token fixture (must match the
// server's 32-hex PDF token shape). Intentionally NOT a high-entropy secret so
// the secret scanner does not flag this test fixture.
const VALID_TOKEN = "abcabcabcabcabcabcabcabcabcabcab";
const SHARE_ORIGIN = "https://0509.io";

// --- stub Camofox engine ------------------------------------------------------

function startCamofoxStub({ finalUrl = META_URL } = {}) {
  const tabs = new Map(); // tabId -> { url, deleted }
  let nextId = 1;
  let delay = 0;
  const server = http.createServer(async (req, res) => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const send = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.method === "POST" && req.url === "/tabs") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      const tabId = `tab-${nextId++}`;
      tabs.set(tabId, { url: parsed.url });
      return send(200, { tabId, ok: true });
    }
    const statsMatch = req.method === "GET" && req.url?.match(/^\/tabs\/(tab-\d+)\/stats$/);
    if (statsMatch) {
      const tab = tabs.get(statsMatch[1]);
      return send(200, { url: tab?.url, consecutiveFailures: 0, toolCalls: 1 });
    }
    const snapshotMatch = req.method === "GET" && req.url?.match(/^\/tabs\/(tab-\d+)\/snapshot$/);
    if (snapshotMatch) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ role: "ad", name: "Test Ad" }));
    }
    const screenshotMatch = req.method === "GET" && req.url?.match(/^\/tabs\/(tab-\d+)\/screenshot$/);
    if (screenshotMatch) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(Buffer.alloc(4096, 0x89)); // fake PNG bytes
    }
    const deleteMatch = req.method === "DELETE" && req.url?.match(/^\/tabs\/(tab-\d+)$/);
    if (deleteMatch) {
      tabs.get(deleteMatch[1]).deleted = true;
      return send(200, { ok: true });
    }
    if (req.method === "GET" && req.url === "/health") {
      return send(200, { ok: true, engine: "camoufox", browserConnected: true });
    }
    return send(404, { error: "not found" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port, tabs, setDelay: (ms) => (delay = ms) }),
    );
  });
}

// --- fake chrome / ffmpeg ------------------------------------------------------

async function writeFakeChrome(dir, { html = "<html><body><h1>fake landing</h1></body></html>", shotBytes = 8192 } = {}) {
  const script = `#!/bin/sh
out=""
for arg in "$@"; do
  case "$arg" in
    --screenshot=*|--print-to-pdf=*) out="\${arg#*=}";;
  esac
done
if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  printf '%s' '${shotBytes ? "x".repeat(shotBytes) : html}' > "$out"
  exit 0
fi
printf '%s' '${html}'
exit 0
`;
  const bin = path.join(dir, "fake-chrome");
  await writeFile(bin, script, { mode: 0o755 });
  return bin;
}

async function writeFakeFfmpeg(dir) {
  const script = `#!/bin/sh
in=""
prev=""
out=""
for a in "$@"; do
  if [ "$prev" = "-i" ]; then in="$a"; fi
  prev="$a"
  out="$a"
done
cp "$in" "$out"
exit 0
`;
  const bin = path.join(dir, "fake-ffmpeg");
  await writeFile(bin, script, { mode: 0o755 });
  return bin;
}

// --- HMAC request helper -------------------------------------------------------

function authorize({ method, path: pathname, tenant = "t1", workspace = "w1", jobId = "job-1", body = "", secret = SECRET, nonce, timestamp }) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const nonceValue = nonce ?? crypto.randomUUID().replaceAll("-", "").slice(0, 32);
  const bodyHash = sha256Hex(body);
  const canonical = buildCanonical({ tenant, workspace, jobId, method, path: pathname, bodyHash, timestamp: ts, nonce: nonceValue });
  return {
    authorization: `0509-HMAC ${tenant}:${ts}:${nonceValue}:${sign(canonical, secret)}`,
    bodyHash,
    nonce: nonceValue,
    timestamp: ts,
  };
}

async function jsonRequest(port, { method, path: pathname, body = null, auth, tenant, workspace, jobId }) {
  const headers = {};
  if (auth) headers.authorization = auth.authorization;
  if (body !== null) headers["content-type"] = "application/json";
  const query = tenant || workspace ? `?tenant=${encodeURIComponent(tenant ?? "")}&workspace=${encodeURIComponent(workspace ?? "")}` : "";
  const response = await fetch(`http://127.0.0.1:${port}${pathname}${query}`, {
    method,
    headers,
    body: body === null ? undefined : body,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { status: response.status, payload, headers: response.headers };
}

// --- suite ---------------------------------------------------------------------

let camofox;
let service;
let baseUrl;
let tmpRoot;
let chromeBinPath;
let ffmpegBinPath;
let stateDir;

before(async () => {
  camofox = await startCamofoxStub();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "0509-renderer-test-"));
  stateDir = path.join(tmpRoot, "state");
  await mkdir(stateDir, { recursive: true });
  chromeBinPath = await writeFakeChrome(tmpRoot);
  ffmpegBinPath = await writeFakeFfmpeg(tmpRoot);

  const config = resolveConfig({
    RENDERER_PORT: "0",
    RENDERER_BIND: "127.0.0.1",
    RENDERER_STATE_DIR: stateDir,
    RENDERER_TMP_ROOT: path.join(stateDir, "tmp"),
    RENDERER_ARTIFACTS_ROOT: path.join(stateDir, "artifacts"),
    RENDERER_CHROME_BIN: chromeBinPath,
    RENDERER_FFMPEG_BIN: ffmpegBinPath,
    RENDERER_CAMOFOX_BASE: `http://127.0.0.1:${camofox.port}`,
    RENDERER_PDF_ORIGIN: SHARE_ORIGIN,
    RENDERER_CONCURRENCY: "1",
    RENDERER_MAX_QUEUED: "1",
    RENDERER_DEADLINE_META_MS: "5000",
    RENDERER_DEADLINE_LANDING_MS: "5000",
    RENDERER_DEADLINE_PDF_MS: "5000",
  }, "/home/nish");
  // Deterministic offline networking: stub DNS + stub landing responses.
  config.fetchImpl = async (url, options) =>
    new Response("<html><body><h1>stub landing</h1></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  config.lookup = async (host) => (host === "0509.io" || host === "example.com" ? ["93.184.216.34"] : []);
  const secrets = new HmacVerifier({ activeSecret: SECRET });
  service = createRendererService(config, secrets);
  await service.startupSweep();
  const address = await service.listen();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await service?.close();
  await new Promise((resolve) => camofox.server.close(resolve));
  await rm(tmpRoot, { recursive: true, force: true });
});

// The service queue is shared across tests: wait until it is fully drained so
// concurrency/queue-bound assertions are deterministic (never flaky on residue).
async function waitForQueueIdle(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await jsonRequest(new URL(baseUrl).port, { method: "GET", path: "/readyz" });
    const queue = res.payload?.checks?.queue;
    if (queue && queue.running === 0 && queue.queued === 0) return;
    if (Date.now() > deadline) assert.fail(`queue not idle within ${timeoutMs}ms: ${JSON.stringify(queue)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("healthz is a cheap unauthenticated liveness probe", async () => {
  const res = await jsonRequest(new URL(baseUrl).port, { method: "GET", path: "/healthz" });
  assert.equal(res.status, 200);
  assert.equal(res.payload.ok, true);
});

test("readyz reports readiness against the real engine and binaries", async () => {
  const res = await jsonRequest(new URL(baseUrl).port, { method: "GET", path: "/readyz" });
  assert.equal(res.status, 200);
  assert.equal(res.payload.checks.camofox, true);
  assert.equal(res.payload.checks.chrome, true);
});

test("POST /jobs without auth is 401", async () => {
  const res = await jsonRequest(new URL(baseUrl).port, {
    method: "POST",
    path: "/jobs",
    body: JSON.stringify({ kind: "meta_discovery", tenant: "t1", workspace: "w1", jobId: "noauth", params: { url: META_URL } }),
  });
  assert.equal(res.status, 401);
});

test("meta_discovery job runs end to end and cleans up its tab", async () => {
  await waitForQueueIdle();
  const body = JSON.stringify({ kind: "meta_discovery", tenant: "t1", workspace: "w1", jobId: "meta-1", params: { url: META_URL } });
  const auth = authorize({ method: "POST", path: "/jobs", jobId: "meta-1", body });
  const created = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body, auth });
  assert.equal(created.status, 202);
  assert.equal(created.payload.status, "queued");

  let envelope;
  for (let i = 0; i < 20; i++) {
    // Fresh nonce per poll: each GET is an independent signed request.
    const getAuth = authorize({ method: "GET", path: "/jobs/meta-1", tenant: "t1", workspace: "w1", jobId: "meta-1" });
    const status = await jsonRequest(new URL(baseUrl).port, { method: "GET", path: "/jobs/meta-1", tenant: "t1", workspace: "w1", jobId: "meta-1", auth: getAuth });
    if (status.payload?.result?.status === "completed" || status.payload?.result?.status === "failed") {
      envelope = status.payload.result;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(envelope.status, "completed", JSON.stringify(envelope));
  assert.equal(envelope.finalUrl, META_URL);
  assert.equal(envelope.artifacts.length, 2);
  const snapshot = envelope.artifacts.find((a) => a.name === "snapshot.json");
  assert.equal(snapshot.contentType, "application/json; charset=utf-8");
  assert.match(snapshot.sha256, /^[0-9a-f]{64}$/);

  // Stub tab must have been deleted (cleanup in finally).
  const allTabs = [...camofox.tabs.values()];
  assert.equal(allTabs.every((t) => t.deleted), true);

  // Artifact pull with matching sha256 header (fresh signed GET).
  const artifactAuth = authorize({ method: "GET", path: "/artifacts/meta-1/snapshot.json", tenant: "t1", workspace: "w1", jobId: "meta-1" });
  const artifactRes = await fetch(`${baseUrl}/artifacts/meta-1/snapshot.json?tenant=t1&workspace=w1`, {
    headers: { authorization: artifactAuth.authorization },
  });
  assert.equal(artifactRes.status, 200);
  assert.equal(artifactRes.headers.get("x-artifact-sha256"), snapshot.sha256);
  const bytes = Buffer.from(await artifactRes.arrayBuffer());
  assert.equal(bytes.length, snapshot.bytes);
});

test("landing_snapshot renders with fake chrome + ffmpeg and cleans temp profiles", async () => {
  await waitForQueueIdle();
  const body = JSON.stringify({ kind: "landing_snapshot", tenant: "t1", workspace: "w1", jobId: "land-1", params: { url: "https://example.com/page" } });
  const auth = authorize({ method: "POST", path: "/jobs", jobId: "land-1", body });
  const created = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body, auth });
  assert.equal(created.status, 202);
  for (let i = 0; i < 20; i++) {
    const getAuth = authorize({ method: "GET", path: "/jobs/land-1", tenant: "t1", workspace: "w1", jobId: "land-1" });
    const status = await jsonRequest(new URL(baseUrl).port, { method: "GET", path: "/jobs/land-1", tenant: "t1", workspace: "w1", jobId: "land-1", auth: getAuth });
    if (["completed", "failed"].includes(status.payload?.result?.status)) {
      const envelope = status.payload.result;
      assert.equal(envelope.status, "completed", JSON.stringify(envelope));
      assert.equal(envelope.evidence.redirects, 0);
      const htmlArtifact = envelope.artifacts.find((a) => a.name === "landing.html");
      assert.equal(htmlArtifact.contentType, "text/html; charset=utf-8");
      const jpegArtifact = envelope.artifacts.find((a) => a.name === "landing.jpeg");
      assert.equal(jpegArtifact.contentType, "image/jpeg");
      assert.ok(jpegArtifact.bytes > 0);
      // Temp profiles cleaned up.
      const leftovers = await readdir(path.join(stateDir, "tmp")).catch(() => []);
      assert.equal(leftovers.length, 0, `tmp leftovers: ${leftovers}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("landing job never finished");
});

test("report_pdf renders only the signed same-origin share URL", async () => {
  await waitForQueueIdle();
  const body = JSON.stringify({ kind: "report_pdf", tenant: "t1", workspace: "w1", jobId: "pdf-1", params: { token: VALID_TOKEN } });
  const auth = authorize({ method: "POST", path: "/jobs", jobId: "pdf-1", body });
  const created = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body, auth });
  assert.equal(created.status, 202);
  for (let i = 0; i < 20; i++) {
    const getAuth = authorize({ method: "GET", path: "/jobs/pdf-1", tenant: "t1", workspace: "w1", jobId: "pdf-1" });
    const status = await jsonRequest(new URL(baseUrl).port, { method: "GET", path: "/jobs/pdf-1", tenant: "t1", workspace: "w1", jobId: "pdf-1", auth: getAuth });
    if (["completed", "failed"].includes(status.payload?.result?.status)) {
      const envelope = status.payload.result;
      assert.equal(envelope.status, "completed", JSON.stringify(envelope));
      assert.equal(envelope.url, `${SHARE_ORIGIN}/share/${VALID_TOKEN}?pdf=1`);
      const pdf = envelope.artifacts.find((a) => a.name === "report.pdf");
      assert.equal(pdf.contentType, "application/pdf");
      assert.ok(pdf.bytes > 0);
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("pdf job never finished");
});

test("job kind policies reject invalid params before enqueue", async () => {
  const badUrl = JSON.stringify({ kind: "meta_discovery", tenant: "t1", workspace: "w1", jobId: "m-bad", params: { url: "https://evil.example/ads/library/?id=1" } });
  const authUrl = authorize({ method: "POST", path: "/jobs", jobId: "m-bad", body: badUrl });
  const resUrl = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body: badUrl, auth: authUrl });
  assert.equal(resUrl.status, 400);
  assert.equal(resUrl.payload.error.code, "meta_host");

  const badToken = JSON.stringify({ kind: "report_pdf", tenant: "t1", workspace: "w1", jobId: "p-bad", params: { token: "https://evil.example/x" } });
  const authToken = authorize({ method: "POST", path: "/jobs", jobId: "p-bad", body: badToken });
  const resToken = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body: badToken, auth: authToken });
  assert.equal(resToken.status, 400);
  assert.equal(resToken.payload.error.code, "pdf_token_invalid");

  const badKind = JSON.stringify({ kind: "arbitrary_evaluate", tenant: "t1", workspace: "w1", jobId: "k-bad", params: {} });
  const authKind = authorize({ method: "POST", path: "/jobs", jobId: "k-bad", body: badKind });
  const resKind = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body: badKind, auth: authKind });
  assert.equal(resKind.status, 400);
  assert.equal(resKind.payload.error.code, "invalid_job_kind");
});

test("landing URL policy rejects private targets through the API", async () => {
  const body = JSON.stringify({ kind: "landing_snapshot", tenant: "t1", workspace: "w1", jobId: "l-ssrf", params: { url: "http://169.254.169.254/latest/meta-data" } });
  const auth = authorize({ method: "POST", path: "/jobs", jobId: "l-ssrf", body });
  const res = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body, auth });
  // The literal IP fails synchronously at enqueue time.
  assert.equal(res.status, 400);
  assert.equal(res.payload.error.code, "private_ip");
});

test("idempotency key returns the cached result with 200", async () => {
  await waitForQueueIdle();
  const body = JSON.stringify({ kind: "meta_discovery", tenant: "t1", workspace: "w1", jobId: "idem-1", idempotencyKey: "idem-key", params: { url: META_URL } });
  const auth1 = authorize({ method: "POST", path: "/jobs", jobId: "idem-1", body });
  const first = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body, auth: auth1 });
  assert.equal(first.status, 202);
  // Wait for the job to actually complete (fresh-nonce polling) before replay.
  for (let i = 0; i < 40; i++) {
    const pollAuth = authorize({ method: "GET", path: "/jobs/idem-1", tenant: "t1", workspace: "w1", jobId: "idem-1" });
    const poll = await jsonRequest(new URL(baseUrl).port, { method: "GET", path: "/jobs/idem-1", tenant: "t1", workspace: "w1", jobId: "idem-1", auth: pollAuth });
    if (poll.payload?.result?.status === "completed") break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const body2 = JSON.stringify({ kind: "meta_discovery", tenant: "t1", workspace: "w1", jobId: "idem-2", idempotencyKey: "idem-key", params: { url: META_URL } });
  const auth2 = authorize({ method: "POST", path: "/jobs", jobId: "idem-2", body: body2 });
  const replay = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body: body2, auth: auth2 });
  assert.equal(replay.status, 200);
  assert.equal(replay.payload.cached, true);
  assert.equal(replay.payload.status, "completed");
});

test("exact signed request replay is rejected atomically", async () => {
  const body = JSON.stringify({ kind: "meta_discovery", tenant: "t1", workspace: "w1", jobId: "replay-1", params: { url: META_URL } });
  const auth = authorize({ method: "POST", path: "/jobs", jobId: "replay-1", body });
  const first = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body, auth });
  assert.ok([200, 202].includes(first.status));
  const second = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body, auth });
  assert.equal(second.status, 401);
  assert.equal(second.payload.error.code, "replay_detected");
});

test("queue bounds: 1 running + 1 queued, then 429", async () => {
  await waitForQueueIdle();
  // Submit three jobs synchronously (same tick): the first occupies the single
  // worker, the second queues, the third must be rejected 429. The stub
  // Camofox is slowed down so the first job cannot finish between submits.
  camofox.setDelay(400);
  try {
    const mk = (jobId) => {
      const body = JSON.stringify({ kind: "meta_discovery", tenant: "t1", workspace: "w1", jobId, params: { url: META_URL } });
      const auth = authorize({ method: "POST", path: "/jobs", jobId, body });
      return { body, auth };
    };
    const r1 = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body: mk("q-1").body, auth: mk("q-1").auth });
    const r2 = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body: mk("q-2").body, auth: mk("q-2").auth });
    const r3 = await jsonRequest(new URL(baseUrl).port, { method: "POST", path: "/jobs", body: mk("q-3").body, auth: mk("q-3").auth });
    assert.equal(r1.status, 202);
    assert.equal(r2.status, 202);
    assert.equal(r3.status, 429);
  } finally {
    camofox.setDelay(0);
  }
});

test("size caps: oversized rendered HTML fails the job", async () => {
  // Point a second service at a fake chrome that emits > 1 MiB HTML.
  const bigDir = path.join(tmpRoot, "big");
  await mkdir(bigDir, { recursive: true });
  const bigChrome = await writeFakeChrome(bigDir, { html: "x".repeat(1_200_000) });
  const bigConfig = resolveConfig({
    RENDERER_PORT: "0",
    RENDERER_BIND: "127.0.0.1",
    RENDERER_STATE_DIR: path.join(stateDir, "big-state"),
    RENDERER_TMP_ROOT: path.join(stateDir, "big-tmp"),
    RENDERER_ARTIFACTS_ROOT: path.join(stateDir, "big-artifacts"),
    RENDERER_CHROME_BIN: bigChrome,
    RENDERER_FFMPEG_BIN: ffmpegBinPath,
    RENDERER_CAMOFOX_BASE: `http://127.0.0.1:${camofox.port}`,
    RENDERER_PDF_ORIGIN: SHARE_ORIGIN,
    RENDERER_CONCURRENCY: "1",
    RENDERER_MAX_QUEUED: "1",
  }, "/home/nish");
  bigConfig.fetchImpl = async () =>
    new Response("<html>big</html>", { status: 200, headers: { "content-type": "text/html" } });
  bigConfig.lookup = async (host) => (host === "example.com" ? ["93.184.216.34"] : []);
  const bigSecrets = new HmacVerifier({ activeSecret: SECRET });
  const bigService = createRendererService(bigConfig, bigSecrets);
  const bigAddress = await bigService.listen();
  try {
    const body = JSON.stringify({ kind: "landing_snapshot", tenant: "t1", workspace: "w1", jobId: "big-1", params: { url: "https://example.com/big" } });
    const auth = authorize({ method: "POST", path: "/jobs", jobId: "big-1", body });
    await jsonRequest(bigAddress.port, { method: "POST", path: "/jobs", body, auth });
    for (let i = 0; i < 20; i++) {
      const getAuth = authorize({ method: "GET", path: "/jobs/big-1", tenant: "t1", workspace: "w1", jobId: "big-1" });
      const status = await jsonRequest(bigAddress.port, { method: "GET", path: "/jobs/big-1", tenant: "t1", workspace: "w1", jobId: "big-1", auth: getAuth });
      if (["completed", "failed"].includes(status.payload?.result?.status)) {
        assert.equal(status.payload.result.status, "failed");
        assert.equal(status.payload.result.error.code, "html_too_large");
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail("big job never finished");
  } finally {
    await bigService.close();
    await rm(bigDir, { recursive: true, force: true });
  }
});
