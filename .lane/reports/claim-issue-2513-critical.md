# claim/issue-2513-critical

Archive is a real sixth competitor section (#2173). Gate B now expects 6 links.
Mobile onboarding Track CTA kept in the initial viewport (padding + stack + scroll-margin).

Proof: `E2E_START_LOCAL_SERVER=1 npx playwright test e2e/journey-2-release.spec.ts --project=local-release` → 7 passed.
GATE-B onboarding tracking action mobile box.y=165.265625.
