-- Speed setting a fleet was sent at (10..100), so its return leg can be re-timed from the orbits at turnaround.
ALTER TABLE fleets ADD COLUMN speed_pct int NOT NULL DEFAULT 100;
