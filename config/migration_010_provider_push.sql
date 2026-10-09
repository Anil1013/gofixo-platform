-- Store browser push subscriptions for provider background alerts.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS provider_push_subscriptions (
  id SERIAL PRIMARY KEY,
  provider_id INT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (provider_id, endpoint)
);
