-- Migration 061: Update DeFi agent prices + mark as featured
-- WAS-182: Launch pricing (50% of target) + is_featured = true
-- Safe to re-run: only updates existing rows, no inserts

UPDATE agents SET price_per_call = 0.010, is_featured = true WHERE slug = 'wasi-chainlink-price';
UPDATE agents SET price_per_call = 0.020, is_featured = true WHERE slug = 'wasi-defi-sentiment';
UPDATE agents SET price_per_call = 0.050, is_featured = true WHERE slug = 'wasi-onchain-analyzer';
UPDATE agents SET price_per_call = 0.100, is_featured = true WHERE slug = 'wasi-contract-auditor';
UPDATE agents SET price_per_call = 0.200, is_featured = true WHERE slug = 'wasi-risk-report';
