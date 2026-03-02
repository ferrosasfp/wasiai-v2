CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  events      TEXT[] NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  webhook_id  TEXT NOT NULL REFERENCES webhooks ON DELETE CASCADE,
  event       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  status_code INTEGER,
  success     BOOLEAN NOT NULL DEFAULT false,
  attempt     INTEGER NOT NULL DEFAULT 1,
  delivered_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_webhooks" ON webhooks
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_see_own_deliveries" ON webhook_deliveries
  FOR SELECT USING (
    webhook_id IN (SELECT id FROM webhooks WHERE user_id = auth.uid())
  );

CREATE INDEX idx_webhooks_user ON webhooks(user_id);
CREATE INDEX idx_deliveries_webhook ON webhook_deliveries(webhook_id, delivered_at DESC);
