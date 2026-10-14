import express, { type Express } from 'express';
import type { Queryable } from './db/pool';
import { errorHandler } from './middleware/errorHandler';
import { buildRouter } from './routes';

/** App factory: the DB pool is injected so tests can target foodbridge_test. */
export function createApp(db: Queryable): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', buildRouter(db));
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
  app.use(errorHandler);
  return app;
}
