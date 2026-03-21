-- 074: DeFi Chat Collection — WAS-CHAT-DEFI-COLLECTION / SDD #092
-- Crea colección 'defi-chat' y asocia los 5 agentes del Chat DeFi beta.
-- Idempotente: ON CONFLICT DO NOTHING en todos los INSERTs.

-- 1. Crear colección
INSERT INTO collections (slug, name, description, featured, sort_order)
VALUES ('defi-chat', 'DeFi Chat', 'Agents available for the DeFi Chat beta', true, 0)
ON CONFLICT (slug) DO NOTHING;

-- 2. Insertar agentes (resuelve slug → uuid, falla si slug no existe)
DO $$
DECLARE
  col_id uuid;
  agent_slugs text[] := ARRAY[
    'wasi-chainlink-price',
    'wasi-defi-sentiment',
    'wasi-onchain-analyzer',
    'wasi-contract-auditor',
    'wasi-risk-report'
  ];
  s text;
  a_id uuid;
BEGIN
  SELECT id INTO col_id FROM collections WHERE slug = 'defi-chat';
  IF col_id IS NULL THEN
    RAISE EXCEPTION 'defi-chat collection not found after insert';
  END IF;

  FOREACH s IN ARRAY agent_slugs LOOP
    SELECT id INTO a_id FROM agents WHERE slug = s;
    IF a_id IS NULL THEN
      RAISE EXCEPTION 'Agent slug not found in agents table: %', s;
    END IF;
    INSERT INTO collection_agents (collection_id, agent_id, sort_order)
    VALUES (col_id, a_id, array_position(agent_slugs, s))
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
