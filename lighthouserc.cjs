// Lighthouse CI config (stock lhci file). The deployed audit measures the
// public pages only, so no Access cookie or session is forwarded. Budgets stay
// in lighthouse-budget.json.
// `lhci assert` refuses --budgetsFile and config assertions in the same run
// (its own "Cannot use both budgets AND assertions" error) and this file is
// auto-detected on every lhci call, so the console-errors assertion is
// exported only when assert runs without a budgets file — the step that
// enforces it calls `lhci assert --config=lighthouserc.cjs`.
const assertions = process.argv.some(arg => /^--budgets-?file/i.test(arg))
  ? undefined
  : { "errors-in-console": ["error", { maxLength: 0 }] };

module.exports = {
  ci: {
    assert: { assertions },
  },
};
