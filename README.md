# Cinder Reach

A multiplayer browser space-strategy game. Players build up planets, research technology, build fleets and fight each other in a shared universe. The server is authoritative: every cost, timer, battle and mission outcome is decided on the server from one rules engine.

## Run it locally

Requirements: Node 22+, and Docker (for Postgres) or any Postgres 14+.

```bash
npm install
cp .env.example .env          # set POSTGRES_PASSWORD and the same password in DATABASE_URL
docker compose up -d db       # Postgres on localhost:5432
npm run dev                   # applies migrations, builds the client, serves http://localhost:3000
```

Open the page, create an account, and open a second browser profile to create an opponent.

To run the whole stack in containers: `docker compose --profile app up --build`.

## Tests

```bash
npm test         # rules unit tests + integration tests against an in-process Postgres (PGlite)
npm run typecheck
```

The integration tests drive real accounts through registration, building, research, shipyard batches, attacks with plunder and debris, espionage, colonisation limits, expeditions, missiles, moons, transport, recall, newcomer protection, galaxy, highscore and the HTTP API.

## Universe settings

Set in `.env` (see `.env.example`). They are meant to stay fixed for the life of a universe.

| Setting | Effect |
|---|---|
| `UNIVERSE_SPEED` | Multiplies production; divides building, research and shipyard time |
| `FLEET_SPEED` | Divides flight time |
| `GALAXIES`, `SYSTEMS` | Universe size (positions are always 1–15, plus 16 for expeditions) |
| `DEBRIS_FACTOR` | Share of destroyed ships' metal and crystal that becomes debris |
| `DEFENCE_REBUILD` | Chance each destroyed defence unit is rebuilt |
| `NOOB_PROTECTION` | Players under this score can't be attacked by, or attack, players 5× their size |

## What the game includes

- **Economy:** metal, crystal, deuterium and energy; mines, solar plant, fusion reactor, satellites; storage; per-producer output settings; position bonuses and temperature effects.
- **Colony picture:** Resources, Facilities, Shipyard and Defence show a landscape image of the planet, and a picture of each building, ship and defence appears on it once you have built it. The artwork is plain image files in `web/img`; `web/img/README.md` lists every file name with a prompt for generating it. Without images the tabs show lists only.
- **Buildings:** 17, including Nanite Factory, Terraformer, Missile Silo and the moon-only Lunar Base, Sensor Phalanx and Jump Gate.
- **Research:** 16 technologies with requirements, including the Intergalactic Research Network and Graviton.
- **Shipyard:** 14 ship types and 10 defences and missiles, with batch queues and rapid fire.
- **Fleets:** attack, espionage, transport, deployment, colonisation, debris harvesting and expeditions; speed settings, fuel, cargo, fleet slots and recall.
- **Combat:** six rounds with shields, bounce, explosions and rapid fire; plunder, debris and defence rebuild; moon creation.
- **Orbits (new, not in the classic game):** planets circle their star, so distance, flight time and fuel between two planets in the same system change over time. Return flights are re-timed from where the planets are when the fleet turns around, and missile strikes inside a system take longer when the target is on the far side of the star. The solar system view shows where everything is, previews up to 72 hours ahead, and predicts each planet's next closest approach.
- **Other:** interplanetary and anti-ballistic missiles, phalanx scans, jump gates, colonisation limits from Astrophysics, newcomer protection, messages and a highscore.

## Architecture

See [AGENTS.md](AGENTS.md) for the layout and how time and events work.

## Known limits and next steps

- **One writer at a time.** All writes are serialised by a Postgres advisory lock. This is simple and correct and comfortably handles a small universe; a large universe would move to per-planet locking.
- **Not yet built:** alliances, combined attacks, the trader, officers, moon destruction, building demolition, vacation mode, account deletion, email verification and password reset.
- **Before going public:** add rate limiting on sign-in and registration, put the server behind HTTPS (`COOKIE_SECURE=true`), and add deployment config for your platform.
