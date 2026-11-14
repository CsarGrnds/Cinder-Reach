# Cinder Reach — agent instructions

This is the single always-on instructions file for AI coding agents working in this repo. `CLAUDE.md` and `.github/copilot-instructions.md` point here.

## Rules

- **Commits:** every commit an AI agent makes must have a message starting with `Claudia - ` (for example `Claudia - Add expedition outcomes`).
- **Secrets:** keep secrets in `.env` (gitignored). Never hardcode or commit them. Document new settings in `.env.example` with a placeholder value.
- **The server is authoritative.** The browser never decides an outcome. Every rule that changes state runs on the server; the client only uses `src/rules` to display costs, times and requirements.
- **Game rules live in `src/rules`** as pure functions with no I/O. Server and client import the same module. Change a rule there, add or update a test in `test/rules.test.ts`.

## Layout

| Path | What it is |
|---|---|
| `src/rules/` | Pure rules engine: data tables, formulas, combat, espionage, expeditions |
| `src/server/` | Fastify API, auth, Postgres access, event processor, mission handlers |
| `db/migrations/` | SQL migrations, applied in filename order by `npm run migrate` and on server start |
| `web/` | Browser client (`app.ts` bundled by esbuild into `web/dist/app.js`). `scene.ts` builds the colony picture shown on Resources, Facilities, Shipyard and Defence: a landscape image for the planet's climate with a picture of each building, ship or defence placed on it once it exists. All artwork is image files in `web/img` (names and prompts in `web/img/README.md`); the server lists them at `GET /api/art`. Do not draw artwork in code |
| `test/` | `node:test` suites; integration tests run against an in-process Postgres (PGlite) |

## How time works

- All state changes happen either in a player action or in a scheduled **event** (`events` table): building, research and shipyard completions, fleet arrivals and returns.
- Every write runs inside `world.run()`, which takes a global advisory lock, first processes every event that is due, then runs the action. Events are processed strictly in due-time order.
- Planet resources are stored with the time they were last synced. `syncPlanet(planet, t)` accrues production up to `t` before anything reads or spends them.

## Orbits

In-system distance comes from `src/rules/orbits.ts`: each position orbits its star (period follows Kepler's law, divided by `FLEET_SPEED`; the starting angle is a hash of the coordinates). The server computes distance at launch time, re-times a fleet's way home from the positions at turnaround (same speed setting, stored as `fleets.speed_pct`), and times in-system missiles from the orbital distance (`missileFlightTime`). The client draws the same positions in `web/orrery.ts`. Change orbit rules only in `orbits.ts`.

## Raids

Attacks and missile strikes store the defender's last raid on the planet (`planets.raid`: time, kind, attacker, outcome, units lost). The raid is sent to the client in the planet view; the colony picture does not show it yet.

## Commands

```bash
npm install
cp .env.example .env      # then edit
docker compose up -d db   # local Postgres
npm run dev               # migrate, build client, start server with reload
npm test                  # rules + integration tests (no Docker needed)
npm run typecheck
```
