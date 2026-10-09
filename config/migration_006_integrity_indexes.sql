-- Production integrity indexes for databases created before schema.sql was updated.
-- Run this migration once against the existing Gofixo database.
-- If either index creation reports duplicate rows, resolve those duplicates before retrying.

CREATE UNIQUE INDEX IF NOT EXISTS booking_ratings_one_per_side
  ON booking_ratings (booking_id, rated_by);

CREATE UNIQUE INDEX IF NOT EXISTS provider_subscriptions_one_active
  ON provider_subscriptions (provider_id)
  WHERE status = 'active';
