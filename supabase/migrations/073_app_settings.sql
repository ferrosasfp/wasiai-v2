-- 073_app_settings.sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value, description) VALUES
  ('agent_available_window_days', '7', 'Days since last successful call to consider agent available')
ON CONFLICT (key) DO NOTHING;

-- RLS: lectura pública
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_read" ON app_settings FOR SELECT USING (true);
