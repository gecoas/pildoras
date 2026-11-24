CREATE TABLE IF NOT EXISTS content_entries (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS content_authors (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS content_categories (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS site_config (id integer PRIMARY KEY DEFAULT 1, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (email text PRIMARY KEY, name text NOT NULL DEFAULT '', photo text NOT NULL DEFAULT '', role text NOT NULL DEFAULT 'user', subscribed boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS publication_notifications (entry_id text PRIMARY KEY, sent_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS data_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS entries_data_gin ON content_entries USING gin (data);
