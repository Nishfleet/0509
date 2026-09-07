const JOURNEY_TOKEN_PATTERN = /^[1-6]$/u;

export const ALL_RELEASE_JOURNEYS = Object.freeze([1, 2, 3, 4, 5, 6]);
export const RELEASE_PROOF_PROJECTS = Object.freeze([
  "local-release",
  "local-release-firefox",
  "local-release-webkit",
  "local-release-mobile-safari",
  "local-release-mobile-chrome",
]);

/**
 * The local proof fingerprints the effective source tree, so it does not need
 * a long-lived feature branch to identify the candidate. Default to the
 * checked-out commit while preserving an explicit base for callers that need
 * diff metadata against another ref.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveReleaseCandidateBase(env = process.env) {
  return env.E2E_RELEASE_BASE ?? "HEAD";
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveReleaseProofProject(env = process.env) {
  const project = env.E2E_RELEASE_PROJECT ?? "local-release";
  if (!RELEASE_PROOF_PROJECTS.includes(project)) {
    throw new Error("invalid_release_browser_project");
  }
  return project;
}

/** @param {unknown} value @returns {number[]} */
export function parseJourneyScope(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("invalid_release_journey_scope");
  }

  const tokens = value.split(",").map((token) => token.trim());
  if (tokens.length === 0 || tokens.some((token) => !JOURNEY_TOKEN_PATTERN.test(token))) {
    throw new Error("invalid_release_journey_scope");
  }

  const journeys = tokens.map(Number);
  if (new Set(journeys).size !== journeys.length) {
    throw new Error("duplicate_release_journey");
  }
  return journeys;
}

/**
 * @param {readonly string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @returns {number[]}
 */
export function resolveJourneyScope(argv = [], env = process.env) {
  let cliValue;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--journeys") {
      if (cliValue !== undefined || index + 1 >= argv.length) {
        throw new Error("invalid_release_journey_scope");
      }
      cliValue = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--journeys=")) {
      if (cliValue !== undefined) throw new Error("invalid_release_journey_scope");
      cliValue = argument.slice("--journeys=".length);
      continue;
    }
    if (argument.startsWith("--journeys")) {
      throw new Error("invalid_release_journey_scope");
    }
    throw new Error("invalid_release_journey_argument");
  }

  if (cliValue !== undefined) return parseJourneyScope(cliValue);
  if (env.E2E_RELEASE_JOURNEYS !== undefined) return parseJourneyScope(env.E2E_RELEASE_JOURNEYS);
  return [...ALL_RELEASE_JOURNEYS];
}

/** @param {readonly number[]} journeys @returns {boolean} */
export function isCanonicalReleaseScope(journeys) {
  return Array.isArray(journeys) &&
    journeys.length === ALL_RELEASE_JOURNEYS.length &&
    ALL_RELEASE_JOURNEYS.every((journey) => journeys.includes(journey));
}

/**
 * The launch-facing release proof is always all six journeys. A subset remains
 * useful for diagnostics, but it must be requested explicitly so its passing
 * manifest cannot be mistaken for canonical release evidence.
 *
 * @param {readonly string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ journeys: number[]; diagnosticSubset: boolean }}
 */
export function resolveReleaseProofInvocation(argv = [], env = process.env) {
  const diagnosticArguments = argv.filter((argument) => argument === "--diagnostic-subset");
  if (diagnosticArguments.length > 1) throw new Error("invalid_release_journey_argument");
  const diagnosticSubset = diagnosticArguments.length === 1;
  const journeyArguments = argv.filter((argument) => argument !== "--diagnostic-subset");
  const journeys = resolveJourneyScope(journeyArguments, env);
  if (!diagnosticSubset && !isCanonicalReleaseScope(journeys)) {
    throw new Error("canonical_release_requires_all_journeys");
  }
  return { journeys, diagnosticSubset };
}
