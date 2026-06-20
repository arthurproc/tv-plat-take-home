# AI Usage Log

## Tools used

- **Claude Code (Opus 4.8)** — the primary assistant for the whole task: repo discovery, design discussion, writing the implementation, SQL, and tests, running the app/DB to verify behavior, and the `EXPLAIN` performance work.
- **Claude Code sub-agents (code review)** — after each task I launched a fresh, isolated review agent with an explicit spec and "be adversarial" instructions, to review the diff as an independent reviewer would. Findings were triaged by me before acting.

I drove the process: every design decision (pagination strategy, response shape, access model, DB, PR strategy) was a deliberate choice I made or approved, not an auto-accept. Work was reviewed step by step before anything was committed.

## Representative prompts

A handful of the prompts that did real work (mine, to the assistant):

- *"firstly we are entering on a discovery session, we are going to gather as much information as possible and organize them so I can think of a plan of work … a plan focused on solving the challenge the best way possible."*
- *"explain me with examples this keyset/cursor strategy, as I already understand cursor and keysets I need more context of how you plan to use them together."*
- *"I want to understand if we are actually creating the new GET /resources endpoint or we are modifying one because of backwards compatibility. Do we have any information about backwards compatibility?"*
- *"task 2 is dependent of task 1?"*
- *"I need you now to call a fresh agent to perform a code review on the code you created, provide it with the specs … Let me see the created prompt before triggering the agent."*
- *"fix 1 and 2, then re-run the tests"* (acting on the Task 1 review findings).
- *"go with option A, keep stacking task 2 on the branch"* (one PR for both tasks).
- *"the resources.test.ts had grown too much … let's try to break it into smaller files so it is easier to review"* — then, after seeing the result: *"I did not like this one … let's revert the commit and go back to only one file and let this as a decision … recommending a new task to be included on backlog as technical debt."*

## Where I accepted / rejected / corrected AI output

- **Accepted:** the keyset pagination design (fixed `(created_at DESC, id DESC)` order, opaque cursor, `limit + 1` look-ahead) and the `viewer`-required signature for `findResources` as the regression defense. These matched how I'd build it; I confirmed the reasoning before accepting.
- **Rejected (scope):** a third index `(owner_id, created_at, id)` the assistant initially created while experimenting. After reading the `EXPLAIN` output it wasn't chosen for the real query paths (`/users/:id` is unpaginated), so I had it dropped rather than ship an unjustified index. Also deferred the `UNION` rewrite for low-selectivity viewers to "future work" instead of gold-plating.
- **Corrected (baseline hygiene):** the assistant edited the tracked `.gitignore` in the baseline commit to hide the private challenge email. I reverted that — I wanted the baseline to be the pristine, unmodified seed — and we used a local `.git/info/exclude` instead.
- **Corrected (docs accuracy):** the first README draft referenced `PR_DESCRIPTION.md` as "mirroring the PR" when that file is still the template; I had it reworded to point at the actual GitHub PR.
- **Reverted a refactor that didn't pay off.** I had the assistant split the growing `resources.test.ts` into per-concern files. On review it made things *worse* — more files and shared-setup wiring than the suite size justified — so I reverted to a single file and logged a backlog tech-debt task to design a scalable test pattern first. Both the split and its revert are kept in history rather than squashed, so the decision is visible.

## How I verified AI-generated code

Everything was verified against a real database, not taken on trust.

**SQL**
- Tests run against the **real Docker Postgres** (Vitest + Supertest), not a mocked driver — so query results are real rows, not asserted query strings.
- Assertions check **specific ids**, derived by hand from the deterministic seed (e.g. member #2's visible set `{1,2,6,10,14,18,22,26,30}`), and for access control they assert both **included and excluded** ids, so a broken scoping predicate can't pass silently.
- **`EXPLAIN ANALYZE` on a ~200k-row dataset** I generated, to justify each index: the member-scoped first page went from a `Seq Scan on resources` (199,422 rows discarded) + top-N sort (~110 ms) to an early-stopping `Index Scan` (~1.4 ms). Indexes were chosen from the actual plans, and one was rejected because the planner never used it.
- **Manual `curl`** against the running server for every endpoint and the full access matrix (admin vs member, owner vs shared vs neither, the `/users/:id` cases, the 401/400 errors).

**Tests**
- The subtle microsecond-precision cursor bug was **surfaced by the Task 1 review sub-agent**; after fixing it I verified the new test was a real guard by **reintroducing the bug** (reverting the cursor to millisecond precision) and confirming the test **failed** — page 2 skipped the boundary row — then restoring the fix. A test that doesn't fail on the broken code isn't a test.
- The tampered-cursor tests specifically exercise the value-validation branches that keep a bad cursor a `400` rather than a `500` at the SQL cast.
- Independent **code-review sub-agents** re-checked the predicate composition, parameter indexing, and auth edge cases for each task; their findings were triaged and the actionable one (documenting the index worst case) was applied.
