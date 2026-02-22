-- Migration 008: Add cover_image to agents table
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS cover_image TEXT DEFAULT NULL; -- IPFS URL via Pinata
