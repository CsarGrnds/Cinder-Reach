-- The last hostile strike on a planet (an attack or a missile strike), shown as fires in the colony view.
ALTER TABLE planets ADD COLUMN raid jsonb;
