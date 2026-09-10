# Lane report — claim/issue-2349 (0509 #2349)

Cross-tenant isolation test matrix on real D1.

## Scope

New `tests/integration/tenant-isolation.integration.test.ts` only. Seeds two
independent workspaces (scout plan → `api_access` + `mcp_read_access`) and
asserts every cross-tenant read returns the SAME response a non-existent
resource returns for that route. Per-resource expectations encoded in test
names per the binding judge edit.

Resources covered: collection, watchlist, digest, share token, v1 resource
(collection/watchlist/digest), MCP tool results (get_collection_export /
get_watchlist_export / get_digest_export).

## Verification (green run)

Command: `npx vitest run --project workers tests/integration/tenant-isolation.integration.test.ts`

```
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  5.87s
```

Re-verified on rebased origin/main (`fe5d9e5c`): 10 passed in 4.92s.

## Mutation re-verified on rebased main

After restoring the claim to latest origin/main, re-dropped the `AND user_id = ?`
predicate from `getCollection` and re-ran. The same 3 collection-scoped tests went
red (data-layer `getCollection`, v1 route, and MCP `get_collection_export`), then
the source file was reverted (`git diff` clean) and the suite returned to 10/10.

## Mutation check (test can fail)

Dropped the `AND user_id = ?` scoping predicate from `getCollection`
(`app/lib/data/collections.server.ts`) locally — i.e. the query became
`WHERE id = ?` only, ignoring the passed `userId`. Ran the suite; 3 tests went
red (the test caught the leak). Reverted before commit; `git diff` on the
source file is empty.

Red output (verbatim):

```
 ❯ |workers| tests/integration/tenant-isolation.integration.test.ts (10 tests | 3 failed) 954ms
     × collection: cross-tenant getCollection returns null (same as non-existent id) 61ms
     × v1 collection: cross-tenant read returns 404 (same as non-existent resource id) 260ms
     × MCP get_collection_export: cross-tenant returns not_found error result (same as non-existent collectionId) 104ms

 FAIL  ... > collection: cross-tenant getCollection returns null (same as non-existent id)
AssertionError: cross-tenant collection must be null: expected { id: 'col_0003', …(5) } to be null
- Expected: null
+ Received: { "createdAt": "2026-01-01T00:00:00.000Z", "description": null,
  "id": "col_0003", "name": "Fixture col_0003", "updatedAt": "2026-01-01T00:00:00.000Z",
  "userId": "user_0001" }

 FAIL  ... > v1 collection: cross-tenant read returns 404 (same as non-existent resource id)
AssertionError: cross-tenant v1 collection must 404: expected 200 to be 404
- 404
+ 200

 FAIL  ... > MCP get_collection_export: cross-tenant returns not_found error result (same as non-existent collectionId)
AssertionError: cross-tenant MCP collection must be an error: expected false to be true
- true
+ false

 Test Files  1 failed (1)
      Tests  3 failed | 7 passed (10)
```

After revert, the suite is green again (10 passed).
