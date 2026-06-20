# Resources API — Take-Home Seed

A small REST API over PostgreSQL. TypeScript + Express + `pg` with raw,
parameterized SQL (no ORM). Migrations are plain `.sql` files applied by a
script; tests run with Vitest + Supertest.

This repo runs cleanly out of the box. Your tasks are in **[CHALLENGE.md](./CHALLENGE.md)**.

## Prerequisites

- Node.js 20+
- Docker (for the Postgres container)

## Run it

```bash
cp .env.example .env
npm install
npm run db:up      # start Postgres in docker
npm run db:reset   # apply migrations + seed deterministic data
npm test           # one example test, should pass
```

To run the server locally:

```bash
npm run dev        # http://localhost:3000
```

## Endpoints

- `GET /resources` — all resources
- `GET /resources/recent` — 10 most recently created
- `GET /users/:userId/resources` — resources owned by a user

All three call a single shared data-access function
(`src/data/resources.ts`).

## Auth

There is no real auth. A stub middleware reads an `x-user-id` header and
attaches `req.userId`; the data layer currently ignores it.

```bash
curl -H 'x-user-id: 2' http://localhost:3000/resources
```

## Scripts

| Script             | What it does                          |
| ------------------ | ------------------------------------- |
| `npm run db:up`    | Start the Postgres container          |
| `npm run db:reset` | Apply migrations, then reseed the DB  |
| `npm run dev`      | Run the server with reload            |
| `npm run build`    | Type-check / compile to `dist/`       |
| `npm test`         | Run the test suite                    |
