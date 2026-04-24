-- Add an indexed prefix column for O(1) API key lookup.
--
-- Previously, every auth request scanned all users and
-- ran bcrypt.compare against each hash. With the prefix,
-- we filter to at most one candidate row first.

ALTER TABLE users
    ADD COLUMN api_key_prefix TEXT;

CREATE INDEX idx_users_api_key_prefix
    ON users (api_key_prefix)
    WHERE api_key_prefix IS NOT NULL;
