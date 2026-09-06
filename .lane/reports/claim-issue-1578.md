# Lane evidence — claim/issue-1578

## Issue

Nishfleet/0509#1578 — Locale cluster omits the first-value search funnel and trust surfaces.

## Verification summary

| Command | Result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm test` (node + workers) | 544 node + 20 workers test files passed; 6,531 + 114 tests passed |
| `npm run e2e:serve:local` + curl matrix | All 20 `/{de,fr,es,ja,pt-br}/{search,competitor-monitoring,capture-rules,ad-aggression}` paths returned HTTP 200 and correct `<html lang>` (including `pt-BR` for `pt-br`) |
| `/api/health` | 200 |
| `/api/health/deep` D1 check | `d1: ok` |
| `/home/nish/.local/bin/sgscan` | No new security findings |

## Example local E2E matrix

```text
/de/search -> 200, lang=de
/de/competitor-monitoring -> 200, lang=de
/de/capture-rules -> 200, lang=de
/de/ad-aggression -> 200, lang=de
/fr/search -> 200, lang=fr
/fr/competitor-monitoring -> 200, lang=fr
/fr/capture-rules -> 200, lang=fr
/fr/ad-aggression -> 200, lang=fr
/es/search -> 200, lang=es
/es/competitor-monitoring -> 200, lang=es
/es/capture-rules -> 200, lang=es
/es/ad-aggression -> 200, lang=es
/ja/search -> 200, lang=ja
/ja/competitor-monitoring -> 200, lang=ja
/ja/capture-rules -> 200, lang=ja
/ja/ad-aggression -> 200, lang=ja
/pt-br/search -> 200, lang=pt-BR
/pt-br/competitor-monitoring -> 200, lang=pt-BR
/pt-br/capture-rules -> 200, lang=pt-BR
/pt-br/ad-aggression -> 200, lang=pt-BR
```

## Notes

- Local E2E server ran at `http://127.0.0.1:4179` via `npm run e2e:serve:local`.
- Server process group was stopped after verification.
