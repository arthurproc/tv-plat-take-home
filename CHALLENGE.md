# Take-Home Challenge

Welcome. This is a small Express + PostgreSQL service that the client uses to
list "resources" (documents, sheets, slides). It works, but it's an early
baseline: the list endpoint is naive, and the shared data path has no access
control. Your job is to bring two pieces up to production quality.

**Time expectation: ~2–3 hours.** This is a scoping exercise as much as a
coding one. Do the two tasks well; don't gold-plate. We're not evaluating
boilerplate — we're evaluating judgment, SQL, and how you communicate trade-offs.

## Getting started

See [README.md](./README.md). After `npm run db:up && npm run db:reset`,
`npm test` should pass.

## The codebase

- `src/data/resources.ts` — a single shared `findResources()` function. It is
  called by three endpoints. **Changing it affects all of them.**
- `src/app.ts` — the three endpoints.
- `src/middleware/auth.ts` — an auth stub that puts `x-user-id` on `req.userId`.
- `migrations/0001_init.sql` — the schema (`users`, `resources`,
  `resource_shares`).
- `scripts/seed.ts` — deterministic seed data.

## Task 1 — Make `GET /resources` production-ready

The endpoint currently returns every resource with no controls. Add:

- **Filtering** by `type` and `status` (query params).
- **Pagination** (your choice of strategy — explain it).
- **Input validation** with sensible error responses for bad params.

## Task 2 — Add access control to the shared data path

Right now any caller sees any resource. Introduce **user-scoped visibility** in
the shared `findResources()` path so a user sees only resources they **own or
that are shared with them** (via `resource_shares`).

Consider:

- Sensible behavior for **admins**.
- What `GET /users/:userId/resources` should return, and to whom.
- That this path is **shared** — think about the blast radius across all three
  endpoints, and about query performance as the tables grow.

> The schema ships with only a baseline set of indexes. If your approach needs
> more, add them.

## Deliverables

1. A **public Git repo** with your solution.
2. An updated **README** if you changed how anything runs.
3. A **PR-style write-up** (see [PR_DESCRIPTION.md](./PR_DESCRIPTION.md) for the
   template) — including an explicit **Testing** section describing what you
   tested and how.
4. An **[AI_LOG.md](./AI_LOG.md)** documenting your AI tool usage.

## AI policy

Using AI tools is **encouraged** — use whatever you'd use on the job. The only
requirement is honesty: keep an **AI_LOG.md** (template provided) covering what
you used, representative prompts, where you accepted/rejected/corrected output,
and — importantly — how you **verified** AI-generated SQL and tests.
