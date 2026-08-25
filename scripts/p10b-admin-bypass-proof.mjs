// THROWAWAY PROOF ARTIFACT — do not merge, do not copy.
//
// Exists only to make one required status check go red on purpose, so that a
// `gh pr merge --admin` attempt can be observed being refused. That is the
// proof that `enforce_admins: true` is actually binding on main, rather than
// merely reported as true by the protection API.
//
// The pattern below is a deliberate violation of the canonical
// no-hand-built-orchestration ruleset: a hand-rolled retry loop with a sleep
// backoff, which is exactly what the fleet forbids. It is inert (never
// imported, never executed) and this branch is closed immediately after the
// refusal is captured.
async function handBuiltRetryLoop(fn) {
  let attempt = 0;
  while (attempt < 5) {
    try {
      return await fn();
    } catch {
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error("retries exhausted");
}

export default handBuiltRetryLoop;
