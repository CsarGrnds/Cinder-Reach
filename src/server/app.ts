import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fstatic from '@fastify/static';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import type { Game } from './game.js';
import { GameError, getUser } from './repo.js';
import { register, login, endSession, sessionUser, SESSION_DAYS } from './auth.js';
import * as A from './actions.js';
import { state, galaxy, highscore, messages } from './views.js';

const COOKIE = 'sid';
const id = z.coerce.number().int().positive();
const res3 = z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]);
const levels = z.record(z.string().max(8), z.number().int().min(0).max(1e9));
const coords = z.object({ g: z.number().int(), s: z.number().int(), p: z.number().int(), moon: z.boolean().optional() });
const creds = z.object({ username: z.string().max(40), password: z.string().max(200) });

export function buildApp(game: Game, opts: { cookieSecure: boolean; webDir?: string; logger?: boolean }) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 64 * 1024 });
  app.register(cookie);
  app.register(fstatic, { root: opts.webDir ?? join(import.meta.dirname, '..', '..', 'web'), index: 'index.html' });

  // Artwork is whatever image files are in web/img; the client asks once which exist.
  const webDir = opts.webDir ?? join(import.meta.dirname, '..', '..', 'web');
  app.get('/api/art', async () => ({ files: (await readdir(join(webDir, 'img')).catch(() => [] as string[])).filter(f => /^[a-z0-9-]+\.(png|webp|jpe?g|avif)$/i.test(f)) }));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError) return reply.code(400).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request.', issues: err.issues });
    if ((err as any).statusCode && (err as any).statusCode < 500) return reply.code((err as any).statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the server.' });
  });

  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: opts.cookieSecure, maxAge: SESSION_DAYS * 86400 });
  async function authed(req: FastifyRequest) {
    const uid = await sessionUser(game.db, req.cookies[COOKIE], game.now());
    if (!uid) throw Object.assign(new Error('Please sign in.'), { statusCode: 401 });
    return uid;
  }
  /** Authenticated write: world caught up, user loaded, serialised with every other write. */
  const act = <T>(req: FastifyRequest, fn: (c: A.Ctx) => Promise<T>) =>
    authed(req).then(uid => game.run(async (q, t) => fn({ game, q, t, user: (await getUser(q, uid))! })));

  app.post('/api/register', async (req, reply) => {
    const b = creds.parse(req.body);
    const { token } = await register(game, b.username, b.password);
    setSession(reply, token);
    return { ok: true };
  });
  app.post('/api/login', async (req, reply) => {
    const b = creds.parse(req.body);
    const { token } = await login(game, b.username, b.password);
    setSession(reply, token);
    return { ok: true };
  });
  app.post('/api/logout', async (req, reply) => {
    await endSession(game.db, req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/state', async req => {
    const uid = await authed(req);
    return game.run((q, t) => state(game, q, t, uid));
  });
  app.get('/api/galaxy', async req => {
    await authed(req);
    const p = z.object({ g: id, s: id }).parse(req.query);
    return game.run(q => galaxy(q, Math.min(p.g, game.U.galaxies), Math.min(p.s, game.U.systems)));
  });
  app.get('/api/highscore', async req => {
    const uid = await authed(req);
    const p = z.object({ page: id.default(1) }).parse(req.query);
    return game.run(q => highscore(q, uid, p.page));
  });
  app.get('/api/messages', async req => {
    const uid = await authed(req);
    return game.run(q => messages(q, uid));
  });

  const post = <S extends z.ZodTypeAny>(path: string, schema: S, fn: (c: A.Ctx, b: z.infer<S>) => Promise<unknown>) =>
    app.post(path, async req => {
      const b = schema.parse(req.body ?? {});
      const r = await act(req, c => fn(c, b));
      return { ok: true, result: r ?? null };
    });

  post('/api/build', z.object({ planetId: id, id: z.string() }), (c, b) => A.build(c, b.planetId, b.id));
  post('/api/build/cancel', z.object({ planetId: id }), (c, b) => A.cancelBuild(c, b.planetId));
  post('/api/research', z.object({ planetId: id, id: z.string() }), (c, b) => A.research(c, b.planetId, b.id));
  post('/api/research/cancel', z.object({}), c => A.cancelResearch(c));
  post('/api/shipyard', z.object({ planetId: id, id: z.string(), n: z.number().int().min(1).max(1e7) }), (c, b) => A.shipyard(c, b.planetId, b.id, b.n));
  post('/api/production', z.object({ planetId: id, key: z.string(), pct: z.number().int() }), (c, b) => A.setProduction(c, b.planetId, b.key, b.pct));
  post('/api/planet/rename', z.object({ planetId: id, name: z.string().max(40) }), (c, b) => A.rename(c, b.planetId, b.name));
  post('/api/planet/abandon', z.object({ planetId: id }), (c, b) => A.abandon(c, b.planetId));
  post('/api/fleet', z.object({ planetId: id, ships: levels, target: coords, mission: z.string(), pct: z.number().int(), cargo: res3 }), (c, b) => A.sendFleet(c, b));
  post('/api/fleet/recall', z.object({ fleetId: id }), (c, b) => A.recall(c, b.fleetId));
  post('/api/missile', z.object({ planetId: id, n: z.number().int(), target: coords }), (c, b) => A.launchMissiles(c, b.planetId, b.n, b.target));
  post('/api/jump', z.object({ planetId: id, targetId: id, ships: levels }), (c, b) => A.jump(c, b.planetId, b.targetId, b.ships));
  post('/api/phalanx', z.object({ planetId: id, target: coords }), (c, b) => A.phalanx(c, b.planetId, b.target));

  return app;
}
