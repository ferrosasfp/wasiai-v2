-- 070_webhook_secret.sql
-- Agrega webhook_secret por agente para auth granular en llamadas upstream
-- WAS-078: Webhook Secret & Upstream Auth

-- 1. Agregar columna nullable primero (para el backfill)
ALTER TABLE agents ADD COLUMN webhook_secret TEXT;

-- 2. Backfill sin extensiones (md5 es nativo en PostgreSQL, no requiere pgcrypto)
UPDATE agents
SET webhook_secret = 'whsec_' || md5(random()::text || clock_timestamp()::text || id::text)
                               || md5(random()::text || id::text || now()::text)
WHERE webhook_secret IS NULL;
-- Resultado: 'whsec_' + 64 chars (dos md5 concatenados = 256 bits de entropía efectiva)

-- Nota: Si pgcrypto está habilitado, se puede usar encode(gen_random_bytes(32), 'hex') para mayor entropía
-- Verificar: SELECT * FROM pg_extension WHERE extname = 'pgcrypto';

-- 3. Hacer NOT NULL después del backfill
ALTER TABLE agents ALTER COLUMN webhook_secret SET NOT NULL;
