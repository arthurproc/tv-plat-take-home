import { NextFunction, Request, Response } from 'express';
import { pool } from '../db';
import { ApiError } from '../http/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
      user?: { id: number; role: 'member' | 'admin' };
    }
  }
}

// Auth STUB — there is no real authentication. It reads the `x-user-id` header
// and attaches the raw value to req.userId. Resolving that into an actual user
// (and enforcing identification) is requireUser's job.
export function authStub(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('x-user-id');
  req.userId = header ? Number(header) : undefined;
  next();
}

// Resolves req.userId into a real user (id + role) and attaches it as req.user.
// A missing, non-numeric, or unknown user id is rejected with 401 — scoped
// endpoints require an identifiable caller. The role is loaded here (not trusted
// from the header) because access decisions, including admin bypass, depend on
// it.
export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.userId === undefined || !Number.isInteger(req.userId)) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'A valid x-user-id header is required.');
    }

    const result = await pool.query<{ id: string; role: 'member' | 'admin' }>(
      'SELECT id, role FROM users WHERE id = $1',
      [req.userId],
    );
    if (result.rows.length === 0) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'A valid x-user-id header is required.');
    }

    req.user = { id: Number(result.rows[0].id), role: result.rows[0].role };
    next();
  } catch (err) {
    next(err);
  }
}
