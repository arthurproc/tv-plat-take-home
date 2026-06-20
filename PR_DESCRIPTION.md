# PR Write-up

> Mirror of GitHub PR #2: https://github.com/arthurproc/tv-plat-take-home/pull/2

Implements both challenge tasks against the shared `findResources` path: Task 1 makes `GET /resources` production-ready (filtering, keyset pagination, validation); Task 2 adds user-scoped access control across all three callers of that path. Two commits, one per task.

## Summary
- **Task 1:** `GET /resources` now supports filtering, keyset/cursor pagination, and input validation with clean JSON errors.
- **Task 2:** the shared `findResources` enforces user-scoped visibility (own ∪ shared; admins bypass), with an index strategy justified by `EXPLAIN`.

## Changes
### Task 1 — list endpoint
- **Filtering** by `type` and `status`.
- **Keyset/cursor pagination** on a fixed `(created_at DESC, id DESC)` order; `id` is the unique tiebreaker; opaque base64url cursor; fetch `limit+1` to detect a next page (no `COUNT`). Cursor boundary carries **microsecond precision** (from Postgres, not the ms-precision JS `Date`) so rows within the same millisecond aren't skipped/duplicated.
- **Validation** via `zod` (`strictObject` rejects unknown params); `limit` ∈ [1,100], default 20.
- **Central error handler** replaces Express's HTML stack pages with `{ error: { code, message, details? } }`; unknown routes → JSON 404; internals never leak. Removed the `ORDER BY ${orderBy}` interpolation footgun (ordering is now fixed server-side).
- Response envelope `{ data, pageSize, nextCursor }`.

### Task 2 — access control on the shared path
- `findResources(viewer, opts)` — **`viewer` is required**, so the compiler forces every caller to scope (primary regression defense for a shared path).
- Non-admin predicate: `owner_id = $v OR EXISTS (resource_shares s WHERE s.resource_id = resources.id AND s.user_id = $v)`; admins bypass.
- `requireUser` middleware resolves `x-user-id` → `{id, role}` from the DB (role not trusted from header); missing/non-numeric/unknown → **401**.
- `GET /users/:userId/resources` = the same predicate with an owner filter: self/admin see the target's full set; a member sees only the target's resources shared with them. `:userId` validated → **400** (was a 500 leak).
- **Indexes** (`migrations/0002`): `idx_resources_created_id (created_at DESC, id DESC)` and `idx_resource_shares_user (user_id, resource_id)`.

## ⚠️ Breaking changes (intentional)
1. `GET /resources` body: bare array → `{ data, pageSize, nextCursor }`.
2. Default page size 20 (was "all rows").
3. Scoped endpoints now require `x-user-id` (401 otherwise); `/resources` and `/resources/recent` are now viewer-scoped.

No consumers exist (no versioning/client/contract in-repo) and the brief directs these changes, so they're made in place rather than versioned.

## Testing
**Automated — 39 integration tests** (Vitest + Supertest against real Docker Postgres, deterministic seed). Run: `npm run db:up && npm run db:reset && npm test`.

- **Pagination:** envelope + default size; newest-first; **full multi-page walk asserting all ids + `Set.size` (no gaps/dupes)**; null `nextCursor` on last page.
- **Filtering:** type / status / combined; paginated-while-filtered exact id sequence; **empty result → `200 []`**.
- **Validation:** `limit` bounds + non-integer + non-numeric; empty `type`; unknown param; malformed cursor → 400; unknown route → JSON 404. Plus 3 **tampered-but-decodable** cursors → `400 INVALID_CURSOR` (guard the SQL casts against a 500).
- **Keyset edges:** identical `created_at`; **microsecond-only** difference within the same millisecond.
- **Access control:** admin-all; member own ∪ shared (asserts **included AND excluded** ids); **owned+shared not double-counted**; no-access exclusion; empty for a member with nothing; scoped `/recent`; `/users/:id` self/admin/member-intersection/empty; 401 (missing/non-numeric/unknown user); `/users/:id` bad id → 400.

**What could break for other callers, and how verified:**
- `findResources` feeds 3 endpoints. Making `viewer` required = **build-time** failure until every caller is updated. **Regression tests** assert `/resources/recent` and `/users/:id` keep their bare-array contracts.
- The microsecond cursor fix was verified **failing-first**: reverting to the ms cursor made that test fail (page 2 skipped the boundary row).
- **Performance** (`EXPLAIN ANALYZE` on a ~200k-row dataset): member-scoped first page went from `Seq Scan on resources` (199,422 rows discarded) + top-N sort (~110 ms) to an early-stopping `Index Scan using idx_resources_created_id` with the share check as an index-only scan (~1.4 ms). The `resource_shares` PK `(resource_id, user_id)` can't serve a `user_id` lookup, hence `idx_resource_shares_user`.
- Out-of-band **manual `curl`** confirmed envelopes, a real cursor round-trip, the access matrix per caller, and JSON error bodies.

## Trade-offs / deliberately not done
- **Low-selectivity worst case:** a viewer whose visible rows are all old makes the index scan walk a long prefix before `LIMIT`. The clean fix (a `UNION` of an owner branch and a shared branch, each index-backed) is documented as future work; the typical case is well bounded.
- Rejected an `(owner_id, created_at, id)` index — unjustified, since `/users/:id` is unpaginated and the baseline owner index + a tiny sort suffices.
- `/users/:userId/resources` remains unpaginated (pre-existing contract); pagination is a future enhancement.
- Auth is the provided stub; `requireUser` accepts loose numeric header coercions (gated by a real DB lookup). A real auth layer would parse stricter.

- **Process trade-off — no spec-driven workflow.** To stay inside the ~2h window I deliberately skipped the spec-driven development workflow I normally use with agents (driving the work from a formal written spec the agent implements against). For a task this small the overhead outweighed the benefit, so I steered design decisions interactively and reviewed each step instead.
- **Single agent session, by design.** I did all of the work in one assistant session so it kept full context across both tasks and the review cycles. That works well here precisely because the codebase is small — little risk of the context filling with irrelevant material and degrading results. On a larger codebase I'd deliberately compartmentalize across sessions/agents to avoid that.

## Open questions
- For `/users/:userId/resources`, the chosen behavior is the *uniform* access rule (member sees only shared-with-them), not a flat 403/404 — confirm that matches product intent.
- Should `/users/:userId/resources` and `/resources/recent` adopt the same pagination envelope as `/resources` for consistency?

