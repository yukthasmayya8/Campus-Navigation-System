-- Campus Navigation System - PostgreSQL + PostGIS schema (idempotent)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS roles (
  role_id   SMALLINT PRIMARY KEY,
  role_name TEXT NOT NULL UNIQUE CHECK (role_name IN ('admin','super_admin'))
);
INSERT INTO roles (role_id, role_name) VALUES (1,'admin'),(2,'super_admin')
ON CONFLICT (role_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  user_id               BIGSERIAL PRIMARY KEY,
  name                  TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  email                 TEXT NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  password_hash         TEXT NOT NULL,
  role_id               SMALLINT NOT NULL REFERENCES roles(role_id),
  account_status        TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','inactive')),
  force_password_change BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_id    BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expiry_time TIMESTAMPTZ NOT NULL,
  used_status BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS prt_user_idx ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS locations (
  location_id    BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 150),
  description    TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  latitude       DOUBLE PRECISION NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude      DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  geom           geography(Point,4326) GENERATED ALWAYS AS
                   (ST_SetSRID(ST_MakePoint(longitude, latitude),4326)::geography) STORED,
  image_url      TEXT NULL CHECK (image_url IS NULL OR length(image_url) <= 1000),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS locations_geom_gix   ON locations USING GIST (geom);
CREATE INDEX IF NOT EXISTS locations_status_idx ON locations (status);
CREATE INDEX IF NOT EXISTS locations_name_trgm  ON locations USING GIN (lower(name) gin_trgm_ops);
-- Two active locations may not share a name (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS locations_active_name_uq ON locations (lower(btrim(name))) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS routes (
  route_id                BIGSERIAL PRIMARY KEY,
  source_location_id      BIGINT NOT NULL REFERENCES locations(location_id),
  destination_location_id BIGINT NOT NULL REFERENCES locations(location_id),
  route_name              TEXT NOT NULL CHECK (length(btrim(route_name)) BETWEEN 1 AND 150),
  directionality          TEXT NOT NULL CHECK (directionality IN ('one_way','bidirectional')),
  has_stairs              BOOLEAN NULL,   -- NULL = not verified (never "no")
  has_ramp                BOOLEAN NULL,
  is_covered              BOOLEAN NULL,
  notes                   TEXT NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive')),
  version_number          INTEGER NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  created_by              BIGINT NOT NULL REFERENCES users(user_id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT routes_distinct_endpoints CHECK (source_location_id <> destination_location_id)
);
CREATE INDEX IF NOT EXISTS routes_endpoints_idx ON routes (source_location_id, destination_location_id);
CREATE INDEX IF NOT EXISTS routes_status_idx    ON routes (status);

CREATE TABLE IF NOT EXISTS route_points (
  point_id        BIGSERIAL PRIMARY KEY,
  route_id        BIGINT NOT NULL REFERENCES routes(route_id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  latitude        DOUBLE PRECISION NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude       DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  geom            geography(Point,4326) GENERATED ALWAYS AS
                    (ST_SetSRID(ST_MakePoint(longitude, latitude),4326)::geography) STORED,
  accuracy        DOUBLE PRECISION NULL CHECK (accuracy IS NULL OR accuracy >= 0),
  recorded_at     TIMESTAMPTZ NULL,
  CONSTRAINT route_points_seq_uq UNIQUE (route_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS route_waypoints (
  waypoint_id     BIGSERIAL PRIMARY KEY,
  route_id        BIGINT NOT NULL REFERENCES routes(route_id) ON DELETE CASCADE,
  location_id     BIGINT NOT NULL REFERENCES locations(location_id),
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  CONSTRAINT route_waypoints_seq_uq UNIQUE (route_id, sequence_number),
  CONSTRAINT route_waypoints_loc_uq UNIQUE (route_id, location_id)
);

CREATE TABLE IF NOT EXISTS location_versions (
  version_id         BIGSERIAL PRIMARY KEY,
  location_id        BIGINT NOT NULL REFERENCES locations(location_id),
  version_number     INTEGER NOT NULL,
  snapshot_data      JSONB NOT NULL,
  modified_by        BIGINT NULL REFERENCES users(user_id),
  modified_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_description TEXT NOT NULL DEFAULT '',
  CONSTRAINT location_versions_uq UNIQUE (location_id, version_number)
);

CREATE TABLE IF NOT EXISTS route_versions (
  version_id         BIGSERIAL PRIMARY KEY,
  route_id           BIGINT NOT NULL REFERENCES routes(route_id) ON DELETE CASCADE, -- cascade only used when a DRAFT is discarded
  version_number     INTEGER NOT NULL,
  snapshot_data      JSONB NOT NULL,
  modified_by        BIGINT NULL REFERENCES users(user_id),
  modified_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_description TEXT NOT NULL DEFAULT '',
  CONSTRAINT route_versions_uq UNIQUE (route_id, version_number)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id           BIGSERIAL PRIMARY KEY,
  administrator_id BIGINT NULL REFERENCES users(user_id),
  action           TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        BIGINT NULL,
  previous_data    JSONB NULL,
  new_data         JSONB NULL,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_logs (entity_type, entity_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS audit_time_idx   ON audit_logs (timestamp DESC);
