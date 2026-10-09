-- Adds subscription tiers for Auto drivers (same tiers as Car for now — adjust via admin later)
INSERT INTO subscription_plans (provider_type, plan_name, fee, earning_cap, validity_days) VALUES
('auto', 'basic', 250, 10000, 365),
('auto', 'pro', 400, 20000, 365);
