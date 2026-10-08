-- Migration 0002: Add AI recognition configuration to users table
ALTER TABLE users ADD COLUMN ai_api_key TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN ai_base_url TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN ai_model TEXT DEFAULT NULL;
