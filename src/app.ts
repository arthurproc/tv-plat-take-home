import express from 'express';
import { authStub } from './middleware/auth';
import { findResources } from './data/resources';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(authStub);

  // GET /resources
  // Caller #1 of the shared findResources path.
  // Returns ALL resources — no filtering, no pagination, no input validation.
  // (See CHALLENGE.md, task 1.)
  app.get('/resources', async (_req, res, next) => {
    try {
      const resources = await findResources();
      res.json(resources);
    } catch (err) {
      next(err);
    }
  });

  // GET /resources/recent
  // Caller #2 of the shared findResources path.
  app.get('/resources/recent', async (_req, res, next) => {
    try {
      const resources = await findResources({ limit: 10, orderBy: 'created_at desc' });
      res.json(resources);
    } catch (err) {
      next(err);
    }
  });

  // GET /users/:userId/resources
  // Caller #3 of the shared findResources path.
  app.get('/users/:userId/resources', async (req, res, next) => {
    try {
      const ownerId = Number(req.params.userId);
      const resources = await findResources({ ownerId });
      res.json(resources);
    } catch (err) {
      next(err);
    }
  });

  return app;
}
