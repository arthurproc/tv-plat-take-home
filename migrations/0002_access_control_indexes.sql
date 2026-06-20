-- 0002_access_control_indexes.sql
--
-- Indexes that make user-scoped access control (Task 2) efficient and keep the
-- keyset-paginated list off a full table scan. Justified with EXPLAIN ANALYZE
-- against a ~200k-row dataset (see PR write-up):
--
--   member-scoped first page, before: Seq Scan on resources (199,422 rows
--     discarded) + top-N sort, ~110 ms.
--   after: Index Scan using idx_resources_created_id, stops after ~21 matches,
--     no sort node, ~1.4 ms.
--
-- Worst case: this is not constant-time. A viewer whose visible rows are all
-- OLD (owns/shares little among recent resources) forces the newest-first scan
-- to walk a long prefix before LIMIT is met, degenerating toward a full index
-- scan with a correlated EXISTS probe per row. The clean fix at scale is a
-- UNION of an owner branch and a shared branch, each index-backed and limited;
-- left as future work (see PR write-up) as the typical case is well bounded.

-- Serves the fixed ORDER BY (created_at DESC, id DESC) used by every list query.
-- Lets the access-scoped query scan newest-first and stop early (LIMIT) instead
-- of scanning and sorting the whole table. Also backs Task 1's keyset cursor.
CREATE INDEX IF NOT EXISTS idx_resources_created_id
  ON resources (created_at DESC, id DESC);

-- The resource_shares PRIMARY KEY is (resource_id, user_id), so it cannot serve
-- a lookup keyed on user_id. This index answers both "is this resource shared
-- with the viewer?" (the correlated EXISTS) and "which resources are shared with
-- the viewer?" as an index-only scan (resource_id is included as the 2nd column).
CREATE INDEX IF NOT EXISTS idx_resource_shares_user
  ON resource_shares (user_id, resource_id);
