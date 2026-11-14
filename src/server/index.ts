import { loadConfig } from './config.js';
import { pgDb, migrate } from './db.js';
import { Game } from './game.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
const db = pgDb(cfg.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log('Applied migrations:', applied.join(', '));

const game = new Game(db, cfg.universe);
const app = buildApp(game, { cookieSecure: cfg.cookieSecure, logger: true });

// Process due events even when nobody is online, so attacks land and builds finish on time.
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try { await game.tick(); } catch (e) { app.log.error(e); } finally { ticking = false; }
}, 1000);

const stop = async () => { clearInterval(timer); await app.close(); await db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await app.listen({ port: cfg.port, host: cfg.host });
