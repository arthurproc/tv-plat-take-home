import { ApiError } from './errors';
import type { Cursor } from '../data/resources';

// The pagination cursor is intentionally OPAQUE to clients: a base64url-encoded
// JSON blob. Clients must treat it as a black box and pass it back verbatim, so
// we are free to change its internals later without breaking them.

export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify({ c: cursor.createdAt, id: cursor.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

// Decodes and fully validates a client-supplied cursor. Any malformed,
// tampered, or junk cursor yields a 400 — never a 500 from bad SQL input.
export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw malformed();
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).c !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw malformed();
  }

  const { c, id } = parsed as { c: string; id: string };

  // Validate the embedded values so a tampered cursor can't reach SQL as junk
  // (an unparseable timestamp or a non-numeric id would otherwise cause a
  // 500 at the ::timestamptz / ::bigint cast).
  if (Number.isNaN(Date.parse(c))) {
    throw malformed();
  }
  if (!/^\d+$/.test(id)) {
    throw malformed();
  }

  return { createdAt: c, id };
}

function malformed(): ApiError {
  return new ApiError(400, 'INVALID_CURSOR', 'The cursor parameter is malformed.');
}
