import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Universe } from '../rules/index.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const num = (d: number) => z.coerce.number().positive().default(d);
const Env = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see .env.example)'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  UNIVERSE_SPEED: num(1),
  FLEET_SPEED: num(1),
  GALAXIES: z.coerce.number().int().min(1).max(99).default(9),
  SYSTEMS: z.coerce.number().int().min(1).max(999).default(499),
  DEBRIS_FACTOR: z.coerce.number().min(0).max(1).default(0.3),
  DEFENCE_REBUILD: z.coerce.number().min(0).max(1).default(0.7),
  NOOB_PROTECTION: z.coerce.number().min(0).default(50000),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(env);
  const universe: Universe = {
    speed: e.UNIVERSE_SPEED, fleetSpeed: e.FLEET_SPEED, galaxies: e.GALAXIES, systems: e.SYSTEMS,
    debrisFactor: e.DEBRIS_FACTOR, defenceRebuild: e.DEFENCE_REBUILD, noobProtection: e.NOOB_PROTECTION,
  };
  return { databaseUrl: e.DATABASE_URL, port: e.PORT, host: e.HOST, cookieSecure: e.COOKIE_SECURE === 'true', universe };
}
export type Config = ReturnType<typeof loadConfig>;
