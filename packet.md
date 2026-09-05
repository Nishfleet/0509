# Approved implementation packet: MagicBrief migration promise

## Goal
Make the existing MagicBrief migration promise executable and proof-safe without inventing a proprietary export format: document the supported generic competitor-list inputs already implemented by 0509, map what can and cannot be preserved, report rejected or unsupported fields without silent loss, and provide a truthful manual fallback. Add deterministic fixture-based proof. Do not claim full MagicBrief migration unless a real export fixture exists.

## Owned files
- `docs/magicbrief-migration.md` (new guide)
- `tests/magicbrief-migration.test.ts` (new deterministic guide/fixture tests)
- `docs/market-desk-first-value-progress.md` only if needed to link the guide or clarify the existing limitation
- Existing competitor import implementation may be read for exact behavior, but do not change it unless a focused test proves a repository-fixable defect required by this packet.

## Constraints and exclusions
- No auth, billing, pricing/legal copy, migrations, deploy/gate workflows, lockfiles, dependencies, secrets, provider dashboards, or external account writes.
- Do not fabricate a MagicBrief export shape, customer data, import success, or screenshot/evidence preservation.
- Treat the actual supported input as the existing generic competitor-list paste/CSV path. If the source includes analytics/report fields, state explicitly that they are not imported and must be retained by the customer or manually recreated.
- Preserve every unsupported field in the rejected-field report; never silently discard it.
- The guide must distinguish supported, rejected, and manual-fallback paths and must not imply that collections/tags/evidence are fully portable without a real fixture.
- Use only sanitized inline fixtures with no PII or secrets.

## Acceptance criteria
1. The guide names the exact supported input forms and the current import mapping for brand/competitor website, optional name, notes, tags, and client grouping only where the code actually supports them.
2. It explicitly lists unsupported MagicBrief data (including analytics/report history and any collection/evidence fields not represented by the generic importer), explains that no full MagicBrief export contract is verified, and gives a manual recreation fallback.
3. A sanitized fixture representing each supported input form exercises the existing parser/preview behavior; unsupported columns are surfaced in a rejected-field report and invalid/duplicate rows are not silently dropped.
4. Tests prove no secrets or PII are present in fixtures and prove the guide's claims stay aligned with the parser's real accepted fields.
5. The implementation remains documentation/test focused, small, and reversible; no public pricing/legal claim is broadened.

## Verification
- `npx vitest run tests/magicbrief-migration.test.ts tests/competitor-import.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `git diff --check`

## Worker behavior
Choose the clearest safe structure and test shape within the owned files. Do not ask for approval: this sealed packet is the approved plan. If the repository contradicts the packet or a required claim cannot be proven from code, stop and report the exact contradiction rather than guessing.
