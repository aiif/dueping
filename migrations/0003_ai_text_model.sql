-- Migration 0003: Add AI text model configuration to users table
ALTER TABLE users ADD COLUMN ai_text_model TEXT DEFAULT NULL;
