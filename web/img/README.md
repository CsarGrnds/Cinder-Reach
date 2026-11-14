# Artwork

The colony picture on Resources, Facilities, Shipyard and Defence is built from the image files in this folder. Nothing is drawn in code. Drop a file in with the right name and it shows up; no code change or rebuild is needed. With no landscape image, the tabs show plain lists.

## Rules

- **Landscapes** (`bg-*.jpg`, `.png` or `.webp`): 21:9, about 2520×1080. Horizon a little above the middle. The lower half must be open, flat, empty ground, because the buildings stand there. No buildings in the landscape itself.
- **Everything else**: PNG or WebP with a **transparent background**, about 1024 px wide, one object, nothing cropped. Seen from a three-quarter view slightly above, lit from the upper left, so all pictures match.
- File names are the item's name in lower case with dashes, exactly as listed below.
- The same picture is used on the landscape and as the thumbnail in the list.

## Prompts

Start every prompt with the same style line so the set matches:

> Dark painted sci-fi concept art, matte painting, teal and steel-blue palette, moody atmospheric haze, small warm and cyan lights, highly detailed, realistic proportions.

For landscapes add: `Wide 21:9 alien landscape, horizon just above the middle, empty flat plain filling the lower half, no buildings, no ships, no people, no text.`

For objects add: `Single isolated object, three-quarter view from slightly above, lit from the upper left, transparent background, no ground, no text.`

### Landscapes (4)

| File | Subject |
|---|---|
| `bg-mild.jpg` | temperate world: dark green-teal plain, jagged mountains on the horizon, a large ringed planet low in a teal night sky |
| `bg-hot.jpg` | hot world: cracked dark rock plain, glowing lava rivers far away, red-orange dusk sky |
| `bg-cold.jpg` | frozen world: blue-white ice plain, ice cliffs on the horizon, pale aurora in a dark sky |
| `bg-moon.jpg` | airless moon: grey dust plain with craters, black starry sky, the home planet large above the horizon |

### Resources (8)

| File | Subject |
|---|---|
| `metal-mine.png` | open-pit metal mine with a tall headframe, conveyor and ore heaps |
| `crystal-mine.png` | mine built around a cluster of large glowing blue crystals, with drilling rigs |
| `deuterium-synthesizer.png` | chemical plant with electrolysis columns, pipes and glowing teal tanks |
| `solar-plant.png` | field of tilted solar panels around a small control building |
| `fusion-reactor.png` | heavy domed reactor with a glowing core ring and cooling towers |
| `metal-storage.png` | large steel warehouse with stacked metal ingots outside |
| `crystal-storage.png` | armoured vault with glass silos full of blue crystal |
| `deuterium-tank.png` | group of spherical pressure tanks on steel legs |

### Facilities (9)

| File | Subject |
|---|---|
| `robotics-factory.png` | automated factory hall with robot arms on the roof and a loading bay |
| `shipyard.png` | huge open hangar with gantry cranes and a half-built starship hull inside |
| `research-lab.png` | research complex with an observatory dome, antenna dishes and lit windows |
| `missile-silo.png` | ground silo with open blast doors and a missile nose visible |
| `nanite-factory.png` | sleek sealed black hexagonal building with thin glowing seams |
| `terraformer.png` | giant ring-shaped machine standing upright, energy beam in its centre |
| `lunar-base.png` | cluster of pressurised domes and tunnels on moon dust |
| `sensor-phalanx.png` | very large tilted sensor dish array on a rotating base |
| `jump-gate.png` | tall standing ring gate with a glowing blue energy field inside |

### Ships (14)

| File | Subject |
|---|---|
| `light-fighter.png` | small agile single-seat space fighter |
| `heavy-fighter.png` | bulkier armoured space fighter with twin engines |
| `cruiser.png` | fast medium warship, long and slim |
| `battleship.png` | massive heavy warship with many gun turrets |
| `battlecruiser.png` | sleek large warship built for speed, forward gun batteries |
| `bomber.png` | wide heavy bomber with a bomb bay underneath |
| `destroyer.png` | huge angular warship with one very large main cannon |
| `deathstar.png` | enormous flat triangular mothership, the size of a moon, glowing core in the centre |
| `small-cargo.png` | small boxy freighter |
| `large-cargo.png` | long heavy freighter with container modules |
| `colony-ship.png` | large rounded colony ship with habitat rings |
| `recycler.png` | industrial salvage ship with large collector arms |
| `espionage-probe.png` | tiny spy probe with antennas and a lens |
| `solar-satellite.png` | small satellite with wide solar panels |

### Defences (10)

| File | Subject |
|---|---|
| `rocket-launcher.png` | ground rocket launcher turret with a rack of missiles |
| `light-laser.png` | small laser turret |
| `heavy-laser.png` | large twin-barrel laser turret |
| `gauss-cannon.png` | long-barrelled electromagnetic cannon on a heavy mount |
| `ion-cannon.png` | cannon with glowing blue coils along the barrel |
| `plasma-turret.png` | massive turret with a glowing green plasma chamber |
| `small-shield-dome.png` | shield generator projecting a small translucent energy dome |
| `large-shield-dome.png` | large shield generator projecting a wide translucent energy dome |
| `anti-ballistic-missile.png` | slim interceptor missile on a launch rail |
| `interplanetary-missile.png` | very large missile standing on a launch pad |

To see it working with the least effort, make `bg-mild.jpg` and the eight Resources pictures first.
