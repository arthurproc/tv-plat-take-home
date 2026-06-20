import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

// A client-safe error. `status` is the HTTP code; `code` is a stable,
// machine-readable string; `message` is human-readable; `details` is optional
// structured context. Anything thrown that is NOT an ApiError is treated as an
// unexpected internal error and is never leaked to the client.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found.' },
  });
}

// Centralized error handler. Always returns JSON (never Express's default HTML
// stack page) and never leaks internal error details to the client. Must keep
// all four parameters so Express recognizes it as error-handling middleware.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid query parameters.',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  // Unknown/unexpected: log server-side for debugging, return an opaque 500 so
  // we never leak internals (e.g. raw Postgres errors) to callers.
  console.error(err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
  });
}
