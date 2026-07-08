-- ============================================================
-- WKH-147: DROP de las 4 columnas legacy de creator_profiles
-- ============================================================
-- Origen: WKH-SEC-03 (creator_earnings RLS por-fila, DONE 2026-07-05) movio las
-- columnas financieras/PII a la tabla nueva creator_earnings. La migracion fue
-- reversible SIN DROP (20260705000001, CD-12): las 4 columnas quedaron fisicamente
-- en creator_profiles (inertes, service_role-only tras el REVOKE) como red de rollback.
--
-- Este DROP se aplica tras el soak (fix estable sin necesidad de rollback).
--
-- Verificacion pre-DROP (2026-07-08, adversarial, GO en las 4):
--   - 0 lecturas/escrituras de estas columnas DESDE creator_profiles en codigo desplegado
--     (todo el flujo vivo lee/escribe creator_earnings, keyed por creator_id).
--   - Dual-write removido en Fase B (20260705000001 CREATE OR REPLACE de los RPCs).
--   - Sin select('*') sobre creator_profiles (todos los selects son columnas explicitas).
--   - Sin trigger que lea estas columnas (on_creator_profile_created solo inserta creator_id).
--   - REVOKE ya aplicado (20260705000001:116-137).
--
-- ORDEN DE APLICACION: bdwv (dev/testnet) primero, luego caldz (mainnet/prod).
-- IRREVERSIBLE: dropea la red de rollback de WKH-SEC-03.
-- ============================================================

BEGIN;

ALTER TABLE public.creator_profiles
  DROP COLUMN IF EXISTS total_earnings,
  DROP COLUMN IF EXISTS pending_earnings_usdc,
  DROP COLUMN IF EXISTS account_status,
  DROP COLUMN IF EXISTS email_domain;

COMMIT;
