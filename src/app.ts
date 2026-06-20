import express from 'express';
import { authStub } from './middleware/auth';
import { findResources } from './data/resources';
import { listResourcesQuerySchema } from './http/validation';
import { decodeCursor, encodeCursor } from './http/cursor';
import { errorHandler, notFoundHandler } from './http/errors';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(authStub);

  // GET /resources
  // Caller #1 of the shared findResources path.
  // Filtering (type, status), keyset pagination, and input validation.
  // Returns an envelope: { data, pageSize, nextCursor }.
  app.get('/resources', async (req, res, next) => {
    try {
      const query = listResourcesQuerySchema.parse(req.query);
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

      const { rows, nextCursor } = await findResources({
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
  // Caller #2 of the shared findResources path. Contract unchanged: 10 newest.
  app.get('/resources/recent', async (_req, res, next) => {
    try {
      const { rows } = await findResources({ limit: 10 });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // GET /users/:userId/resources
  // Caller #3 of the shared findResources path. Contract unchanged: all
  // resources owned by :userId. (Access control is Task 2.)
  app.get('/users/:userId/resources', async (req, res, next) => {
    try {
      const ownerId = Number(req.params.userId);
      const { rows } = await findResources({ ownerId });
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
