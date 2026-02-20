-- WasiAI Core Schema
-- Models: AI models listed on the marketplace
CREATE TABLE IF NOT EXISTS models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category TEXT NOT NULL, -- 'nlp', 'vision', 'audio', 'code', 'multimodal'
  price_per_call NUMERIC(18,6) NOT NULL DEFAULT 0.02, -- USDC
  currency TEXT NOT NULL DEFAULT 'USDC',
  chain TEXT NOT NULL DEFAULT 'avalanche',
  endpoint_url TEXT, -- API endpoint
  capabilities JSONB DEFAULT '[]', -- machine-readable capability descriptions
  metadata JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'paused', 'reviewing'
  is_featured BOOLEAN DEFAULT false,
  total_calls BIGINT DEFAULT 0,
  total_revenue NUMERIC(18,6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Model calls log (for analytics + billing)
CREATE TABLE IF NOT EXISTS model_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES models(id) ON DELETE CASCADE,
  caller_id UUID REFERENCES auth.users(id), -- null if agent call
  caller_type TEXT NOT NULL DEFAULT 'human', -- 'human', 'agent'
  agent_id TEXT, -- agent identifier for non-human calls
  amount_paid NUMERIC(18,6) NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  latency_ms INT,
  called_at TIMESTAMPTZ DEFAULT NOW()
);

-- Creator profiles
CREATE TABLE IF NOT EXISTS creator_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  wallet_address TEXT,
  total_earnings NUMERIC(18,6) DEFAULT 0,
  total_models INT DEFAULT 0,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent API keys (for programmatic access)
CREATE TABLE IF NOT EXISTS agent_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  budget_usdc NUMERIC(18,6) DEFAULT 10, -- spending limit
  spent_usdc NUMERIC(18,6) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_keys ENABLE ROW LEVEL SECURITY;

-- Models: public read, authenticated create/edit own
CREATE POLICY "models_public_read" ON models FOR SELECT USING (status = 'active');
CREATE POLICY "models_creator_manage" ON models FOR ALL USING (creator_id = auth.uid());

-- Model calls: creator sees their model calls
CREATE POLICY "calls_creator_read" ON model_calls FOR SELECT
  USING (model_id IN (SELECT id FROM models WHERE creator_id = auth.uid()));

-- Creator profiles: public read
CREATE POLICY "profiles_public_read" ON creator_profiles FOR SELECT USING (true);
CREATE POLICY "profiles_owner_manage" ON creator_profiles FOR ALL USING (id = auth.uid());

-- Agent keys: owner only
CREATE POLICY "agent_keys_owner" ON agent_keys FOR ALL USING (owner_id = auth.uid());

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER models_updated_at BEFORE UPDATE ON models FOR EACH ROW EXECUTE FUNCTION update_updated_at();
