import express from 'express';
import { authStub, requireUser } from './middleware/auth';
import { findResources, Viewer } from './data/resources';
import { listResourcesQuerySchema } from './http/validation';
import { decodeCursor, encodeCursor } from './http/cursor';
import { ApiError, errorHandler, notFoundHandler } from './http/errors';
import { Request } from 'express';

// Builds the Viewer from the resolved req.user. requireUser guarantees req.user
// is present, so any route using this must run after it.
function viewerOf(req: Request): Viewer {
  const user = req.user!;
  return { id: user.id, isAdmin: user.role === 'admin' };
}

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(authStub);

  // GET /resources
  // Caller #1 of the shared findResources path.
  // Filtering (type, status), keyset pagination, input validation, and
  // viewer-scoped access. Returns an envelope: { data, pageSize, nextCursor }.
  app.get('/resources', requireUser, async (req, res, next) => {
    try {
      const query = listResourcesQuerySchema.parse(req.query);
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

      const { rows, nextCursor } = await findResources(viewerOf(req), {
        type: query.type,
        status: query.status,
        cursor,
        limit: query.limit,
      });

      res.json({
        data: rows,
        pageSize: query.limit,
        nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /resources/recent
  // Caller #2 of the shared findResources path: 10 newest VISIBLE to the caller.
  app.get('/resources/recent', requireUser, async (req, res, next) => {
    try {
      const { rows } = await findResources(viewerOf(req), { limit: 10 });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // GET /users/:userId/resources
  // Caller #3 of the shared findResources path: resources owned by :userId that
  // the caller is allowed to see. The same scoping predicate applies, so a
  // member sees only the target's resources shared with them; an admin (or the
  // target viewing themselves) sees all of the target's.
  app.get('/users/:userId/resources', requireUser, async (req, res, next) => {
    try {
      const ownerId = Number(req.params.userId);
      if (!Number.isInteger(ownerId) || ownerId <= 0) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'userId must be a positive integer.',
        );
      }

      const { rows } = await findResources(viewerOf(req), { ownerId });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
