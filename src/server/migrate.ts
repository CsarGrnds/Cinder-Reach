import { loadConfig } from './config.js';
import { pgDb, migrate } from './db.js';

const db = pgDb(loadConfig().databaseUrl);
const applied = await migrate(db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
await db.close();
