import {
  DEFAULT_COUNTRY,
  DEFAULT_MODE,
  DOGFOOD_QUERIES,
  benchmarkProviders,
  findBlockingFreshLiveCurrent0509Failures,
} from "./provider-bakeoff.lib.mjs";

export const DEFAULT_CANARY_BASE_URL = "https://0509.io";
export const DEFAULT_CANARY_WWW_BASE_URL = "https://www.0509.io";
export const DEFAULT_CANARY_API_BASE_URL = "https://api.0509.io";
export const DEFAULT_CANARY_HEALTH_BASE_URLS = Object.freeze([
  DEFAULT_CANARY_BASE_URL,
  DEFAULT_CANARY_WWW_BASE_URL,
  DEFAULT_CANARY_API_BASE_URL,
]);
export const DEFAULT_CANARY_EXPECTED_APP = "0509";
export const DEFAULT_CANARY_FRESH_LIVE_SEARCH_TIMEOUT_MS = 60_000;
export const DEFAULT_CANARY_HEALTH_CONVERGENCE_TIMEOUT_MS = 90_000;
export const DEFAULT_CANARY_HEALTH_CONVERGENCE_INTERVAL_MS = 5_000;

/**
 * @param {string | undefined | null} value
 */
function isConfiguredSecret(value) {
  return Boolean(value?.trim());
}

/**
 * @typedef {{
 *   ok: boolean,
 *   status: number | null,
 *   app: string | null,
 *   expectedApp: string | null,
 *   expectedWorkerVersionId: string | null,
 *   expectedSearchRolloutMode: string | null,
 *   releaseIdentity: { workerVersionId: string | null, tag: string | null, timestamp: string | null, searchRolloutMode: string | null },
 *   releaseIdentityOk: boolean,
 *   message: string | null,
 *   url: string
 * }} HealthCheckResult
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   status: number | null,
 *   message: string | null,
 *   url: string,
 *   blockers: string[],
 *   signals: unknown,
 *   metaAdsBeta: unknown
 * }} LaunchReadinessCheckResult
 */

/**
 * @typedef {{
 *   baseUrl?: string,
 *   healthBaseUrls?: string[],
 *   expectedApp?: string | null,
 *   expectedWorkerVersionId?: string | null,
 *   expectedSearchRolloutMode?: string | null,
 *   queries?: string[],
 *   country?: string,
 *   mode?: "advertiser" | "keyword",
 *   fetchImpl?: typeof fetch,
 *   benchmarkImpl?: typeof benchmarkProviders,
 *   canaryBypassToken?: string,
 *   searchTimeoutMs?: number,
 *   healthConvergenceTimeoutMs?: number,
 *   healthConvergenceIntervalMs?: number,
 *   sleepImpl?: (milliseconds: number) => Promise<void>,
 *   metaAdsStrict?: boolean
 * }} ProductionCanaryOptions
 */

/**
 * @param {ProductionCanaryOptions} options
 * @param {string} baseUrl
 */
function resolveHealthBaseUrls(options, baseUrl) {
  if (options.healthBaseUrls?.length) {
    return [...new Set(options.healthBaseUrls)];
  }
  if (options.baseUrl) {
    return [baseUrl];
  }
  return [...DEFAULT_CANARY_HEALTH_BASE_URLS];
}

/** @param {unknown} value */
function normalizeExpectedWorkerVersionId(value) {
  return normalizeSafeIdentifier(value);
}

/** @param {unknown} value */
function normalizeExpectedSearchRolloutMode(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "v2";
  }
  return normalizeSafeMode(value);
}

/** @param {unknown} value */
function normalizeSafeIdentifier(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9._-]{1,128}$/.test(normalized) ? normalized : null;
}

/** @param {unknown} value */
function normalizeSafeMode(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9_-]{1,32}$/.test(normalized) ? normalized : null;
}

/** @param {unknown} value */
function normalizeSafeTimestamp(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(normalized) &&
    !Number.isNaN(Date.parse(normalized))
    ? normalized
    : null;
}

function emptyReleaseIdentity() {
  return {
    workerVersionId: null,
    tag: null,
    timestamp: null,
    searchRolloutMode: null,
  };
}

/** @param {unknown} value */
function normalizeReleaseIdentity(value) {
  if (!value || typeof value !== "object") {
    return emptyReleaseIdentity();
  }

  const identity = /** @type {{ workerVersionId?: unknown, tag?: unknown, timestamp?: unknown, searchRolloutMode?: unknown }} */ (value);
  return {
    workerVersionId: normalizeSafeIdentifier(identity.workerVersionId),
    tag: normalizeSafeIdentifier(identity.tag),
    timestamp: normalizeSafeTimestamp(identity.timestamp),
    searchRolloutMode: normalizeSafeMode(identity.searchRolloutMode),
  };
}

/**
 * @param {{ workerVersionId: string | null, tag: string | null, timestamp: string | null, searchRolloutMode: string | null }} actual
 * @param {string | null} expectedWorkerVersionId
 * @param {string | null} expectedSearchRolloutMode
 */
function compareReleaseIdentity(actual, expectedWorkerVersionId, expectedSearchRolloutMode) {
  if (!expectedWorkerVersionId) {
    return {
      ok: false,
      message: "Missing expected Worker version ID; canary cannot prove release identity.",
    };
  }
  if (!expectedSearchRolloutMode) {
    return {
      ok: false,
      message: "Invalid expected search rollout mode; canary cannot prove rollout identity.",
    };
  }
  if (!actual.workerVersionId) {
    return {
      ok: false,
      message: "Health endpoint release identity is missing the Worker version ID.",
    };
  }
  if (actual.workerVersionId !== expectedWorkerVersionId) {
    return {
      ok: false,
      message: `Health endpoint Worker version mismatch: expected ${expectedWorkerVersionId}, got ${actual.workerVersionId}.`,
    };
  }
  if (!actual.searchRolloutMode) {
    return {
      ok: false,
      message: "Health endpoint release identity is missing the search rollout mode.",
    };
  }
  if (actual.searchRolloutMode !== expectedSearchRolloutMode) {
    return {
      ok: false,
      message: `Health endpoint search rollout mode mismatch: expected ${expectedSearchRolloutMode}, got ${actual.searchRolloutMode}.`,
    };
  }
  return { ok: true, message: null };
}

/**
 * @param {{ baseUrl?: string, expectedApp?: string | null, expectedWorkerVersionId?: string | null, expectedSearchRolloutMode?: string | null, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<HealthCheckResult>}
 */
export async function checkHealthEndpoint(options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_CANARY_BASE_URL;
  const expectedApp = normalizeSafeIdentifier(options.expectedApp ?? DEFAULT_CANARY_EXPECTED_APP) ?? DEFAULT_CANARY_EXPECTED_APP;
  const expectedWorkerVersionId = normalizeExpectedWorkerVersionId(
    options.expectedWorkerVersionId ?? process.env.CANARY_EXPECTED_WORKER_VERSION_ID,
  );
  const expectedSearchRolloutMode = normalizeExpectedSearchRolloutMode(
    options.expectedSearchRolloutMode ?? process.env.CANARY_EXPECTED_SEARCH_ROLLOUT_MODE,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL("/api/health", baseUrl).toString();

  try {
    const response = await fetchImpl(url, {
      redirect: "manual",
      headers: {
        "user-agent": "0509-prod-canary/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({}));
    const app = normalizeSafeIdentifier(payload?.app);
    const appMatches = expectedApp ? app === expectedApp : true;
    const releaseIdentity = normalizeReleaseIdentity(payload?.releaseIdentity);
    const releaseIdentityChecks = compareReleaseIdentity(
      releaseIdentity,
      expectedWorkerVersionId,
      expectedSearchRolloutMode,
    );
    const healthy =
      response.ok &&
      payload?.status === "ok" &&
      appMatches &&
      releaseIdentityChecks.ok;
    const message =
      healthy
        ? null
        : !response.ok || payload?.status !== "ok"
          ? `Health endpoint returned ${response.status}.`
          : !appMatches
            ? `Health endpoint app mismatch: expected ${expectedApp}, got ${app ?? "unknown"}.`
            : releaseIdentityChecks.message;

    return {
      ok: healthy,
      status: response.status,
      app,
      expectedApp,
      expectedWorkerVersionId,
      expectedSearchRolloutMode,
      releaseIdentity,
      releaseIdentityOk: releaseIdentityChecks.ok,
      message,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      app: null,
      expectedApp,
      expectedWorkerVersionId,
      expectedSearchRolloutMode,
      releaseIdentity: emptyReleaseIdentity(),
      releaseIdentityOk: false,
      message: "Health endpoint unreachable.",
      url,
    };
  }
}

/**
 * Wait for the public route to serve the exact Worker version consistently
 * before the first mutating canary call. This absorbs only provider route
 * propagation; canary failures themselves are never retried. Shared by the
 * launch-readiness cycle (pre-mutation waiter) and the post-deploy Gate C
 * identity anchor (identity_pre / identity_post) so both use one bounded,
 * consecutive-sampling, all-alias, exact-worker + v2-rollout assertion rather
 * than a single fresh-connection snapshot that can hit a lagging edge colo.
 * @param {{ baseUrl?: string, healthBaseUrls?: string[], expectedWorkerVersionId: string, checkHealthImpl?: typeof checkHealthEndpoint, delayImpl?: (ms: number) => Promise<void>, maxSamples?: number, maxWaitMs?: number, requiredConsecutive?: number }} input
 */
export async function waitForExpectedWorkerVersion({
  baseUrl,
  healthBaseUrls,
  expectedWorkerVersionId,
  checkHealthImpl = checkHealthEndpoint,
  delayImpl = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
  maxSamples = 60,
  maxWaitMs = 120_000,
  requiredConsecutive = 3,
}) {
  const resolvedHealthBaseUrls = healthBaseUrls?.length
    ? [...new Set(healthBaseUrls)]
    : baseUrl
      ? [baseUrl]
      : process.env.CANARY_BASE_URL
        ? [process.env.CANARY_BASE_URL]
        : [...DEFAULT_CANARY_HEALTH_BASE_URLS];
  const deadlineReached = Symbol("worker-propagation-deadline");
  const deadlineSignal = AbortSignal.timeout(maxWaitMs);
  let resolveDeadline = () => {};
  const deadlinePromise = new Promise((resolveDeadlinePromise) => {
    resolveDeadline = () => resolveDeadlinePromise(deadlineReached);
    deadlineSignal.addEventListener("abort", resolveDeadline, { once: true });
  });

  let consecutive = 0;
  try {
    for (let sample = 0; sample < maxSamples; sample += 1) {
      const checks = await Promise.race([
        Promise.all(
          resolvedHealthBaseUrls.map((healthBaseUrl) => checkHealthImpl({
            baseUrl: healthBaseUrl,
            expectedWorkerVersionId,
            expectedSearchRolloutMode: "v2",
          })),
        ),
        deadlinePromise,
      ]);
      if (checks === deadlineReached) break;
      consecutive = checks.every((/** @type {{ ok: boolean }} */ check) => check.ok) ? consecutive + 1 : 0;
      if (consecutive >= requiredConsecutive) return;
      if (sample + 1 < maxSamples) {
        const delayResult = await Promise.race([
          delayImpl(2_000),
          deadlinePromise,
        ]);
        if (delayResult === deadlineReached) break;
      }
    }
  } finally {
    deadlineSignal.removeEventListener("abort", resolveDeadline);
  }
  throw new Error("launch_readiness_worker_propagation_not_stable");
}

/**
 * @param {{ baseUrl?: string, canaryBypassToken?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<LaunchReadinessCheckResult>}
 */
export async function checkLaunchReadinessEndpoint(options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_CANARY_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const canaryBypassToken = options.canaryBypassToken ?? process.env.CANARY_BYPASS_TOKEN;
  const url = new URL("/api/launch-readiness", baseUrl).toString();

  if (!isConfiguredSecret(canaryBypassToken)) {
    return {
      ok: false,
      status: null,
      message: "Missing CANARY_BYPASS_TOKEN; launch readiness signals cannot be checked.",
      url,
      blockers: ["missing_canary_bypass_token"],
      signals: null,
      metaAdsBeta: null,
    };
  }
  const canaryToken = String(canaryBypassToken).trim();

  try {
    const response = await fetchImpl(url, {
      headers: {
        "user-agent": "0509-prod-canary/1.0",
        "x-0509-canary-token": canaryToken,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({}));
    const blockers = Array.isArray(payload?.blockers) ? payload.blockers : [];
    const metaAdsBeta =
      payload?.metaAdsBeta && typeof payload.metaAdsBeta === "object"
        ? payload.metaAdsBeta
        : null;

    return {
      ok: response.ok && payload?.ok === true,
      status: response.status,
      message:
        response.ok && payload?.ok === true
          ? null
          : (payload?.message ?? (blockers.join(", ") || `Launch readiness returned ${response.status}.`)),
      url,
      blockers,
      signals: payload?.signals ?? null,
      metaAdsBeta,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: "Launch readiness endpoint unreachable.",
      url,
      blockers: ["launch_readiness_unreachable"],
      signals: null,
      metaAdsBeta: null,
    };
  }
}

/**
 * @param {ProductionCanaryOptions} [options]
 */
export async function runProductionCanary(options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_CANARY_BASE_URL;
  const expectedApp = normalizeSafeIdentifier(options.expectedApp ?? DEFAULT_CANARY_EXPECTED_APP) ?? DEFAULT_CANARY_EXPECTED_APP;
  const expectedWorkerVersionId = normalizeExpectedWorkerVersionId(
    options.expectedWorkerVersionId ?? process.env.CANARY_EXPECTED_WORKER_VERSION_ID,
  );
  const expectedSearchRolloutMode = normalizeExpectedSearchRolloutMode(
    options.expectedSearchRolloutMode ?? process.env.CANARY_EXPECTED_SEARCH_ROLLOUT_MODE,
  );
  const queries = options.queries?.length ? options.queries : [...DOGFOOD_QUERIES];
  const country = options.country ?? DEFAULT_COUNTRY;
  const mode = options.mode ?? DEFAULT_MODE;
  const benchmarkImpl = options.benchmarkImpl ?? benchmarkProviders;
  const canaryBypassToken = options.canaryBypassToken ?? process.env.CANARY_BYPASS_TOKEN;
  const freshLiveBypass = {
    required: true,
    configured: isConfiguredSecret(canaryBypassToken),
    proved: false,
    message: isConfiguredSecret(canaryBypassToken)
      ? null
      : "Missing CANARY_BYPASS_TOKEN; canary cannot prove it bypassed cache and provider cooldown.",
  };
  const searchTimeoutMs = options.searchTimeoutMs ?? DEFAULT_CANARY_FRESH_LIVE_SEARCH_TIMEOUT_MS;
  const metaAdsStrict = options.metaAdsStrict === true;
  const healthBaseUrls = resolveHealthBaseUrls(options, baseUrl);
  const healthConvergenceTimeoutMs = Math.max(
    0,
    options.healthConvergenceTimeoutMs ?? DEFAULT_CANARY_HEALTH_CONVERGENCE_TIMEOUT_MS,
  );
  const healthConvergenceIntervalMs = Math.max(
    0,
    options.healthConvergenceIntervalMs ?? DEFAULT_CANARY_HEALTH_CONVERGENCE_INTERVAL_MS,
  );
  const maxHealthAttempts = expectedWorkerVersionId
    ? Math.max(1, Math.ceil(healthConvergenceTimeoutMs / Math.max(healthConvergenceIntervalMs, 1)) + 1)
    : 1;
  const sleepImpl = options.sleepImpl ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  /** @type {HealthCheckResult[]} */
  let healthChecks = [];
  for (let attempt = 1; attempt <= maxHealthAttempts; attempt += 1) {
    healthChecks = await Promise.all(
      healthBaseUrls.map((healthBaseUrl) =>
        checkHealthEndpoint({
          baseUrl: healthBaseUrl,
          expectedApp,
          expectedWorkerVersionId,
          expectedSearchRolloutMode,
          fetchImpl: options.fetchImpl,
        }),
      ),
    );
    if (healthChecks.every((check) => check.ok) || attempt === maxHealthAttempts) {
      break;
    }
    await sleepImpl(healthConvergenceIntervalMs);
  }
  const health = healthChecks[0] ?? {
    ok: false,
    status: null,
    app: null,
    expectedApp,
    expectedWorkerVersionId,
    expectedSearchRolloutMode,
    releaseIdentity: emptyReleaseIdentity(),
    releaseIdentityOk: false,
    message: "No health endpoints configured.",
    url: new URL("/api/health", baseUrl).toString(),
  };
  const results = await benchmarkImpl({
    providers: ["current_0509"],
    queries,
    country,
    mode,
    baseUrl,
    forceLive: true,
    canaryBypassToken,
    timeoutMs: searchTimeoutMs,
  });
  const launchReadiness = await checkLaunchReadinessEndpoint({
    baseUrl,
    canaryBypassToken,
    fetchImpl: options.fetchImpl,
  });
  const blockingFailures = findBlockingFreshLiveCurrent0509Failures(results);
  const freshLiveBypassFailure = findFreshLiveBypassFailure(results, blockingFailures);
  freshLiveBypass.proved = freshLiveBypass.configured && !freshLiveBypassFailure;
  if (freshLiveBypass.configured && freshLiveBypassFailure) {
    freshLiveBypass.message = freshLiveBypassFailure;
  }
  const readinessNeedsProof = metaAdsReadinessNeedsProof(launchReadiness.metaAdsBeta);
  const metaAdsBeta = {
    beta: true,
    strict: metaAdsStrict,
    status: blockingFailures.length === 0 && !readinessNeedsProof ? "ok" : "needs_proof",
    failures: blockingFailures,
    readiness: launchReadiness.metaAdsBeta ?? null,
  };

  return {
    passed:
      healthChecks.every((check) => check.ok) &&
      launchReadiness.ok &&
      freshLiveBypass.proved &&
      !readinessNeedsProof &&
      blockingFailures.length === 0 &&
      (!metaAdsStrict || blockingFailures.length === 0),
    generatedAt: new Date().toISOString(),
    baseUrl,
    health,
    healthChecks,
    expectedWorkerVersionId,
    expectedSearchRolloutMode,
    launchReadiness,
    queries,
    country,
    mode,
    requireFreshLive: true,
    freshLiveBypass,
    blockingFailures,
    metaAdsBeta,
    results,
  };
}

/**
 * @param {Awaited<ReturnType<typeof runProductionCanary>>} report
 */
export function formatProductionCanaryReport(report) {
  const healthChecks = report.healthChecks?.length ? report.healthChecks : [report.health];
  const expectedVersion = normalizeSafeIdentifier(report.expectedWorkerVersionId) ?? "missing";
  const expectedMode = normalizeSafeMode(report.expectedSearchRolloutMode) ?? "missing";
  const lines = healthChecks.map(
    (health) => `health: ${health.ok ? "ok" : "failed"} (${health.status ?? "no response"}) ${health.url}`,
  );

  for (const health of healthChecks) {
    const actualVersion = normalizeSafeIdentifier(health.releaseIdentity?.workerVersionId) ?? "missing";
    const actualMode = normalizeSafeMode(health.releaseIdentity?.searchRolloutMode) ?? "missing";
    lines.push(
      `health release: expected worker ${expectedVersion}, mode ${expectedMode}; actual worker ${actualVersion}, mode ${actualMode}`,
    );
    if (health.message) {
      lines.push(`health note: ${health.url} ${health.message}`);
    }
  }

  if (report.freshLiveBypass?.required) {
    lines.push(
      report.freshLiveBypass.proved
        ? "fresh-live bypass: ok"
        : `fresh-live bypass: failed (${report.freshLiveBypass.message})`,
    );
  }

  if (report.launchReadiness) {
    lines.push(
      report.launchReadiness.ok
        ? "ops readiness: ok"
        : `ops readiness: failed (${report.launchReadiness.message})`,
    );
  }

  if (report.metaAdsBeta?.status === "needs_proof") {
    const readinessNote = formatReadinessNote(report.metaAdsBeta.readiness);
    lines.push(`meta ads: needs proof${readinessNote}`);
    if (report.blockingFailures.length > 0) {
      lines.push(
        `meta ads probe: ${report.blockingFailures
          .map((result) => `${result.query} (${result.status}, ${result.sourceLabel ?? "no source"})`)
          .join(", ")}`,
      );
    }
    if (report.metaAdsBeta.strict) {
      lines.push("meta ads strict gate: failed");
    }
  } else if (report.metaAdsBeta?.beta) {
    lines.push("meta ads: ok");
  } else if (report.blockingFailures.length === 0) {
    lines.push("search: ok");
  } else {
    lines.push(
      `search: failed for ${report.blockingFailures
        .map((result) => `${result.query} (${result.status}, ${result.sourceLabel ?? "no source"})`)
        .join(", ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * @param {Awaited<ReturnType<typeof benchmarkProviders>>} results
 * @param {Awaited<ReturnType<typeof findBlockingFreshLiveCurrent0509Failures>>} blockingFailures
 */
function findFreshLiveBypassFailure(results, blockingFailures) {
  const currentResults = results.filter((result) => result.provider === "current_0509");
  if (currentResults.length === 0) {
    return "No current_0509 fresh-live probe ran.";
  }

  const loginRedirect = currentResults.find(
    (result) =>
      result.loginWall === true &&
      typeof result.httpStatus === "number" &&
      result.httpStatus >= 300 &&
      result.httpStatus < 400,
  );

  if (loginRedirect) {
    return "Private current_0509 probe was redirected to sign in.";
  }

  if (blockingFailures.length > 0) {
    return "Private current_0509 fresh-live probe did not return live ad proof.";
  }

  return null;
}

/**
 * @param {unknown} readiness
 */
function metaAdsReadinessNeedsProof(readiness) {
  if (!readiness || typeof readiness !== "object") {
    return false;
  }

  return /** @type {{ ok?: unknown }} */ (readiness).ok === false;
}

/**
 * @param {unknown} readiness
 */
function formatReadinessNote(readiness) {
  if (!readiness || typeof readiness !== "object") {
    return "";
  }

  const value = /** @type {{ samples?: unknown, sampleTarget?: unknown, successRate?: unknown }} */ (readiness);
  return ` (${formatNumber(value.samples, 0)}/${formatNumber(value.sampleTarget, 20)} samples, ${formatPercent(value.successRate)} success)`;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function formatNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {unknown} value
 */
function formatPercent(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 100)}%`
    : "0%";
}
