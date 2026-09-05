# Candidate verification summary

- Baseline on origin/main: `npm test` 410 files / 4630 tests passed.
- Candidate 1: typecheck passed; build passed; npm test 410 files / 4632 tests passed; git diff --check passed; sgscan exit 1 with unchanged origin/HEAD warnings only.
- Candidate 2: verification reached sgscan after typecheck/build/npm test; sgscan exit 1 with unchanged origin/HEAD warnings only. Worker did not provide a clean final handoff.
- Candidate 3: worker exited 1 during implementation/verification; added a new launcher and broad interface monkey-patch; not a clean handoff.
- Candidate 4: worker exited 1 during implementation/verification; added NODE_OPTIONS preload shim; not a clean handoff.
- Candidate 5: typecheck passed; build passed; npm test 410 files / 4632 tests passed; git diff --check passed; sgscan exit 1 with unchanged origin/HEAD warnings only.

Observed hosted failure: run 30976143694 failed before the first journey on runner 0509-hardened-verify3 with @cloudflare/vite-plugin getLocalHosts/getPorts/getInputInspectorPort calling os.networkInterfaces and uv_interface_addresses error 97.
