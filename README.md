# Resources API

A small REST API over PostgreSQL for listing multi-tenant "resources".
TypeScript + Express + `pg` with **raw, parameterized SQL** (no ORM). Migrations
are plain `.sql` files applied by a script; tests run with Vitest + Supertest
against a real Postgres in Docker.

Built from the provided seed. The two pieces of work (see
[CHALLENGE.md](./CHALLENGE.md)) are:

1. **`GET /resources`** — filtering, keyset pagination, input validation.
2. **Access control** on the shared `findResources` data path — a caller sees
   only resources they own or that are shared with them.

The PR write-up is the GitHub Pull Request (the
[PR_DESCRIPTION.md](./PR_DESCRIPTION.md) template is included for reference) and
AI usage is logged in **[AI_LOG.md](./AI_LOG.md)**.

## Prerequisites

- Node.js 20+
- Docker (for the Postgres container)

## Run and test

```bash
cp .env.example .env
npm install
npm run db:up      # start Postgres in docker
npm run db:reset   # apply migrations (0001, 0002) + seed deterministic data
npm test           # 39 integration tests, should pass
npm run dev        # run the server at http://localhost:3000
```

> Tests run against the Docker Postgres and reset the schema + seed in
> `beforeAll`. They run serially (one shared database).

## Auth

There is no real auth — a stub middleware reads an `x-user-id` header. Scoped
endpoints now **require** an identifiable caller: the id is resolved to a real
user (and role) from the database, and a missing / non-numeric / unknown id is
rejected with **401**. The role drives admin behavior and is loaded from the DB,
never trusted from the header.

```bash
curl -H 'x-user-id: 2' http://localhost:3000/resources
```

## Endpoints

All three are backed by the single shared `findResources` function and are
viewer-scoped (admins bypass scoping).

### `GET /resources`
Filtering + keyset pagination. Returns an envelope.

| Query param | Notes |
| ----------- | ----- |
| `type`      | optional exact match |
| `status`    | optional exact match |
| `limit`     | optional, 1–100, default 20 |
| `cursor`    | optional, opaque pagination token from a previous response |

Unknown params are rejected (400). Example:

```jsonc
// GET /resources?status=draft&limit=20
{
  "data": [ { "id": "30", "owner_id": "2", "type": "doc", "status": "draft", ... } ],
  "pageSize": 20,
  "nextCursor": "eyJjIjoi..."   // null when there are no more pages
}
```

To get the next page, pass `nextCursor` back as `?cursor=...`.

### `GET /resources/recent`
The 10 most recently created resources **visible to the caller** (bare array).

### `GET /users/:userId/resources`
Resources owned by `:userId` that the caller may see (bare array): self/admin
see the target's full set; a member sees only the target's resources shared with
them. `:userId` must be a positive integer (else 400).

### Errors
All errors are JSON: `{ "error": { "code": "...", "message": "...", "details"?: ... } }`
with appropriate status codes (`400` validation/cursor, `401` auth, `404`
unknown route, `500` opaque internal). No HTML stack pages; no internal leakage.

## Design decisions & trade-offs

**Database — Postgres.** Already wired and preferred by the brief; tests
integration-test against it.

**Pagination — keyset/cursor, not offset.** Ordering is a fixed total order
`(created_at DESC, id DESC)` (`id` is the unique tiebreaker). Each request
fetches `limit + 1` rows to know whether a next page exists without a separate
`COUNT`. The cursor is an **opaque** base64url token and is fully validated, so a
malformed/tampered cursor returns `400`, never a `500`.
- *Why keyset:* stable under concurrent inserts/deletes (no skipped/duplicated
  rows while paging) and constant cost at depth (an index seek, not "scan N and
  discard" like `OFFSET`).
- *Trade-off:* no random page jumps and no cheap total count — the right call
  for a resource list; I'd revisit if the product needed numbered pages.
- *Precision detail:* `pg` maps `timestamptz` to a millisecond JS `Date`, but
  Postgres stores microseconds. The cursor carries the **microsecond** value
  (via `to_char`) so two rows in the same millisecond aren't skipped at a page
  boundary.

**Response envelope `{ data, pageSize, nextCursor }`.** Explicit and
self-documenting. This and the default page size are **intentional breaking
changes** vs. the seed's "bare array of all rows"; there are no consumers in the
repo, and the brief directs making the endpoint production-ready, so it's
changed in place rather than versioned.

**Access control — `viewer` is a required argument.** `findResources(viewer, opts)`
cannot be called without saying who is asking, so the compiler forces every one
of the three callers to scope — the main defense against a regression on a
shared path. Non-admins are limited to `owner_id = me OR EXISTS(a share to me)`;
admins bypass. `GET /users/:userId/resources` is the same predicate with an owner
filter, so its behavior falls out of the one access rule rather than being a
separate policy (a resource shared with me shows up consistently in both
endpoints).

**Validation — `zod`.** Query params validated with a strict schema (unknown
params rejected). One small dependency; clear error messages.

**Indexes — justified with `EXPLAIN ANALYZE` on a ~200k-row dataset.**
- `idx_resources_created_id (created_at DESC, id DESC)` — serves the keyset
  `ORDER BY` and lets the scoped list scan newest-first and stop at `LIMIT`
  instead of seq-scanning + sorting the table. Member-scoped first page:
  **~110 ms → ~1.4 ms**.
- `idx_resource_shares_user (user_id, resource_id)` — the table's PK is
  `(resource_id, user_id)`, which can't serve a `user_id` lookup; this backs the
  share check as an index-only scan.
- *Rejected* `(owner_id, created_at, id)` — only helps a *limited* owner-ordered
  query, but `/users/:userId/resources` is unpaginated and the baseline owner
  index plus a tiny sort already suffices. Avoided the unjustified write cost.

## What I'd do with more time

- **`UNION` rewrite for low-selectivity viewers.** The scoped list's worst case
  (a viewer whose visible rows are all old) still walks a long index prefix. A
  `UNION` of an owner branch and a shared branch — each index-backed and
  individually limited, then merged — bounds that. Documented in
  `migrations/0002`.
- **Paginate `/users/:userId/resources`** and consider the same envelope for it
  and `/resources/recent` for API consistency.
- **Stricter auth / real authentication** in place of the header stub.
- A `CHECK` constraint or enum for `type`/`status` if the product fixes their
  domains.

## Things I'm unsure about

- The `/users/:userId/resources` semantics for a member viewing another user — I
  chose the uniform access rule (see only what's shared with you, no existence
  leak) over a flat `403`/`404`. Worth confirming against product intent.
- Whether `/resources/recent` and `/users/:id` should adopt the paginated
  envelope too, or deliberately stay simple bare-array helpers.

## Scripts

| Script             | What it does                          |
| ------------------ | ------------------------------------- |
| `npm run db:up`    | Start the Postgres container          |
| `npm run db:reset` | Apply migrations, then reseed the DB  |
| `npm run dev`      | Run the server with reload            |
| `npm run build`    | Type-check / compile to `dist/`       |
| `npm test`         | Run the test suite                    |
