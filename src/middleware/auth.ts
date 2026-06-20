import { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

// Auth STUB — there is no real authentication here. It simply reads the
// `x-user-id` header and attaches it to the request.
//
// NOTE: the data layer currently IGNORES req.userId. Wiring it into access
// control is intentionally left undone (see CHALLENGE.md, task 2).
export function authStub(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('x-user-id');
  req.userId = header ? Number(header) : undefined;
  next();
}
