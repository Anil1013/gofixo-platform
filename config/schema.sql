-- Gofixo database schema
-- Run against the gofixo-db database (kept fully separate from mob13r-db)

CREATE TABLE service_providers (
  id SERIAL PRIMARY KEY,
  generated_id VARCHAR(20) UNIQUE NOT NULL,       -- e.g. RL-D-00231
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(15) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL,                       -- bike / car / general_worker / skilled_worker
  kyc_status VARCHAR(20) DEFAULT 'pending',        -- pending / approved / rejected
  bank_upi_id VARCHAR(100),
  avg_rating NUMERIC(2,1) DEFAULT 5.0,
  is_available BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE subscription_plans (
  id SERIAL PRIMARY KEY,
  provider_type VARCHAR(20) NOT NULL,              -- bike / car / general_worker / skilled_worker
  plan_name VARCHAR(20) NOT NULL,                  -- basic / pro
  fee NUMERIC(10,2) NOT NULL,
  earning_cap NUMERIC(10,2) NOT NULL,
  validity_days INT DEFAULT 365
);

CREATE TABLE provider_subscriptions (
  id SERIAL PRIMARY KEY,
  provider_id INT REFERENCES service_providers(id),
  plan_id INT REFERENCES subscription_plans(id),
  start_date TIMESTAMP DEFAULT NOW(),
  expiry_date TIMESTAMP NOT NULL,
  total_earned_this_cycle NUMERIC(10,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active'               -- active / expired / exhausted
);

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  phone VARCHAR(15) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  service_type VARCHAR(10) NOT NULL,               -- ride / pronto
  customer_id INT REFERENCES customers(id),
  provider_id INT REFERENCES service_providers(id),
  pickup_location TEXT,
  drop_or_service_address TEXT,
  fare_amount NUMERIC(10,2),
  duration_minutes INT,                             -- used for Pronto hourly billing
  status VARCHAR(20) DEFAULT 'requested',            -- requested / ongoing / pending_confirmation / completed / disputed
  payment_confirmed_by_provider BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE booking_ratings (
  id SERIAL PRIMARY KEY,
  booking_id INT REFERENCES bookings(id),
  rated_by VARCHAR(10) NOT NULL,                    -- customer / provider
  rating INT CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE earnings_log (
  id SERIAL PRIMARY KEY,
  booking_id INT REFERENCES bookings(id),
  provider_id INT REFERENCES service_providers(id),
  amount NUMERIC(10,2) NOT NULL,
  added_at TIMESTAMP DEFAULT NOW()
);
