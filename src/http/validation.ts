import { z } from 'zod';

// Query-parameter schema for GET /resources.
//
// - `.strictObject` rejects unknown params (e.g. a typo like `?statuss=`) with a
//   400 instead of silently ignoring them — clearer feedback for callers.
// - `limit` is coerced from its string form, bounded to [1, 100], default 20.
// - `type`/`status` are free-text filters; empty strings are rejected so a
//   stray `?type=` is a clear 400 rather than a filter on "".
export const listResourcesQuerySchema = z.strictObject({
  type: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>;
