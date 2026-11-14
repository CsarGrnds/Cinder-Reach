import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Sql } from './db.js';
import type { Game } from './game.js';
import { HOME_FIELDS, POS_TEMP } from '../rules/index.js';
import { fail, insertPlanet } from './repo.js';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, n: number) => Promise<Buffer>;
export const SESSION_DAYS = 30;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export async function checkPassword(pw: string, stored: string) {
  const [, s, h] = stored.split('$');
  const want = Buffer.from(h, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length);
  return timingSafeEqual(got, want);
}
const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createSession(q: Sql, userId: number, now: number) {
  const token = randomBytes(32).toString('base64url');
  await q.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [tokenHash(token), userId, now + SESSION_DAYS * 86_400_000]);
  return token;
}
export async function sessionUser(q: Sql, token: string | undefined, now: number) {
  if (!token) return null;
  const r = (await q.query('SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>$2', [tokenHash(token), now])).rows[0];
  return r ? (r.user_id as number) : null;
}
export async function endSession(q: Sql, token: string | undefined) {
  if (token) await q.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
}

export function validateCredentials(username: string, password: string) {
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) fail('Usernames are 3 to 20 letters, numbers, dashes or underscores.');
  if (password.length < 8 || password.length > 200) fail('Passwords need at least 8 characters.');
}

/** Create an account and place its homeworld on a free position 4–12, filling galaxies in order. */
export async function register(game: Game, username: string, password: string) {
  validateCredentials(username, password);
  const hash = await hashPassword(password);
  return game.run(async (q, t) => {
    const taken = (await q.query('SELECT 1 FROM users WHERE username_key=$1', [username.toLowerCase()])).rows.length;
    if (taken) fail('That username is taken.');
    const userId = (await q.query('INSERT INTO users (username, username_key, pass_hash, created_at, last_seen) VALUES ($1,$2,$3,$4,$4) RETURNING id',
      [username, username.toLowerCase(), hash, t])).rows[0].id as number;
    const U = game.U;
    let spot: { g: number; s: number; p: number } | null = null;
    for (let g = 1; g <= U.galaxies && !spot; g++) {
      for (let i = 0; i < 80 && !spot; i++) {
        const s = 1 + Math.floor(game.rng() * U.systems), p = 4 + Math.floor(game.rng() * 9);
        const r = await q.query('SELECT 1 FROM planets WHERE galaxy=$1 AND system=$2 AND position=$3', [g, s, p]);
        if (!r.rows.length) spot = { g, s, p };
      }
    }
    if (!spot) fail('The universe is full.');
    const temp = POS_TEMP[spot!.p - 1] - 20 + Math.floor(game.rng() * 41);
    await insertPlanet(q, {
      userId, ...spot!, moon: false, home: true, name: 'Homeworld', fields: HOME_FIELDS, temp, dia: 12800,
      res: [500, 500, 0], resAt: t, b: {}, u: {}, pc: {}, bq: null, yq: [], yEnd: 0, jgReady: 0,
    }, t);
    await q.query('INSERT INTO messages (user_id, at, kind, title, body) VALUES ($1,$2,$3,$4,$5)', [userId, t, 'sys', 'Welcome, commander',
      `Your homeworld sits at [${spot!.g}:${spot!.s}:${spot!.p}].\nStart with a Solar Plant, then raise your Metal and Crystal Mines.`]);
    const token = await createSession(q, userId, t);
    return { userId, token };
  });
}

export async function login(game: Game, username: string, password: string) {
  const r = (await game.db.query('SELECT id, pass_hash FROM users WHERE username_key=$1', [username.toLowerCase()])).rows[0];
  if (!r || !(await checkPassword(password, r.pass_hash))) fail('Wrong username or password.');
  return game.db.tx(async q => ({ userId: r.id as number, token: await createSession(q, r.id, game.now()) }));
}
