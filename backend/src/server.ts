import { createApp } from './app';
import { config } from './config';
import { getPool } from './db/pool';
import { startExpiryScheduler } from './services/scheduler';

const db = getPool();
const app = createApp(db);

app.listen(config.port, () => {
  console.log(`[FoodBridge] Backend listening on http://localhost:${config.port}`);
  console.log(`[FoodBridge] Database: ${config.databaseUrl.replace(/:[^:@]*@/, ':***@')}`);
  console.log(`[FoodBridge] Matcher: ${config.matcherUrl} (strategy: ${config.matching.strategy})`);
  startExpiryScheduler(db, config.sweepIntervalSeconds);
  console.log(`[FoodBridge] Expiry sweep: ${config.sweepIntervalSeconds > 0 ? `every ${config.sweepIntervalSeconds}s` : 'disabled'}`);
  if (config.jwtSecret.includes('dev-secret')) {
    console.log('[FoodBridge] WARNING: using the development JWT secret. Set JWT_SECRET in real deployments.');
  }
});
