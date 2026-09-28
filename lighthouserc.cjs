// Lighthouse CI config (stock lhci file). The public pages are audited
// anonymously. The landing audit runs after the workflow exchanges the service
// token for the CF_Authorization cookie (one curl) and this file forwards it
// only when it is set. Budgets stay in lighthouse-budget.json.
// `lhci assert` refuses --budgetsFile and config assertions in the same run
// (its own "Cannot use both budgets AND assertions" error) and this file is
// auto-detected on every lhci call, so the console-errors assertion is
// exported only when assert runs without a budgets file — the step that
// enforces it calls `lhci assert --config=lighthouserc.cjs`.
const assertions = process.argv.some(arg => /^--budgets-?file/i.test(arg))
  ? undefined
  : { "errors-in-console": ["error", { maxLength: 0 }] };

const cookie = process.env.CF_Authorization;

module.exports = {
  ci: {
    collect: cookie
      ? { settings: { extraHeaders: JSON.stringify({ Cookie: `CF_Authorization=${cookie}` }) } }
      : {},
    assert: { assertions },
  },
};
