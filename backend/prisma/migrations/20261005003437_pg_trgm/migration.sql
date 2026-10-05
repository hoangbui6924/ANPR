-- Fuzzy plate search (docs 7.2): "51F15585" also finds "51F15535"
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS plates_norm_trgm ON plates USING gin (plate_norm gin_trgm_ops);
