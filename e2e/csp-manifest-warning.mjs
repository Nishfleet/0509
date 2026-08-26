/**
 * Classifier for the React Router lazy-discovery CSP warning (issue #1051).
 * The visual-defect audit uses this so the canary sweep re-files the class
 * if Firefox (or a Report-Only policy) starts tripping /__manifest again.
 */

export const REACT_ROUTER_MANIFEST_PATH = "/__manifest";

/**
 * @param {unknown} text
 * @returns {boolean}
 */
export function isReactRouterManifestCspWarning(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  const lower = text.toLowerCase();
  if (!lower.includes(REACT_ROUTER_MANIFEST_PATH)) return false;
  return lower.includes("content-security-policy") || lower.includes("connect-src");
}

/**
 * @param {{
 *   consoleMessages?: Array<string | { text?: string }>,
 *   violations?: Array<{ blockedURI?: string, violatedDirective?: string }>,
 * }} input
 * @returns {Array<string | { blockedURI?: string, violatedDirective?: string }>}
 */
export function collectReactRouterManifestCspWarnings(input = {}) {
  const consoleMessages = input.consoleMessages ?? [];
  const violations = input.violations ?? [];
  const fromConsole = consoleMessages
    .map((message) => (typeof message === "string" ? message : message?.text))
    .filter((text) => isReactRouterManifestCspWarning(text));
  const fromViolations = violations.filter((violation) => {
    const uri = String(violation?.blockedURI ?? "");
    const directive = String(violation?.violatedDirective ?? "").toLowerCase();
    return uri.includes(REACT_ROUTER_MANIFEST_PATH) && directive.includes("connect-src");
  });
  return [...fromConsole, ...fromViolations];
}
