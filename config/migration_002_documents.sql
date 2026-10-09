-- KYC documents uploaded per provider (Aadhar, DL, RC, photos, etc.)
CREATE TABLE provider_documents (
  id SERIAL PRIMARY KEY,
  provider_id INT REFERENCES service_providers(id),
  doc_type VARCHAR(30) NOT NULL, -- aadhar / driving_license / vehicle_rc / vehicle_photo / profile_photo / police_verification
  file_url TEXT NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW()
);
